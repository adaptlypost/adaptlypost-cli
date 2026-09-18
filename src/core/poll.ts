import { dim } from './color.js';
import { ExitCode } from './exit-codes.js';

export const MIN_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_MAX_POLL_INTERVAL_MS = 60_000;
export const SEEN_LIMIT = 10_000;

export type Cursor = unknown;

export interface PollPage<T> {
  items: T[];
  cursor: Cursor;
}

export interface PollOptions<T> {
  fetchPage: (cursor: Cursor) => Promise<PollPage<T>>;
  key: (item: T) => string;
  intervalMs: number;
  maxIntervalMs?: number;
  onItem: (item: T) => void | Promise<void>;
  until?: (item: T) => boolean;
  timeoutMs?: number;
  cursor?: Cursor;
  label?: string;
  sleep?: (ms: number) => Promise<void>;
  onExit?: (code: number) => void;
}

export type PollReason = 'until' | 'timeout' | 'interrupted';

export interface PollResult<T> {
  emitted: number;
  polls: number;
  reason: PollReason;
  cursor: Cursor;
  last?: T;
}

class SeenSet {
  private readonly keys = new Map<string, true>();

  constructor(private readonly limit: number) {}

  has(key: string): boolean {
    if (!this.keys.has(key)) return false;
    this.keys.delete(key);
    this.keys.set(key, true);
    return true;
  }

  add(key: string): void {
    if (this.keys.has(key)) this.keys.delete(key);
    this.keys.set(key, true);
    while (this.keys.size > this.limit) {
      const oldest = this.keys.keys().next();
      if (oldest.done) break;
      this.keys.delete(oldest.value);
    }
  }

  get size(): number {
    return this.keys.size;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

function retryAfterMsOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  if (record.status !== 429) return undefined;
  const candidates = [record.retryAfterMs, record.retryAfterSeconds, record.retryAfter];
  for (const [index, candidate] of candidates.entries()) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return index === 0 ? candidate : candidate * 1000;
    }
  }
  const body = record.body;
  if (body && typeof body === 'object') {
    const retryAfter = (body as Record<string, unknown>).retryAfter;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) return retryAfter * 1000;
  }
  return MIN_POLL_INTERVAL_MS;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

export async function poll<T>(options: PollOptions<T>): Promise<PollResult<T>> {
  const floor = Math.max(MIN_POLL_INTERVAL_MS, options.intervalMs);
  const ceiling = Math.max(floor, options.maxIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS);
  const sleep = options.sleep ?? defaultSleep;
  const exit = options.onExit ?? ((code: number) => process.exit(code));
  const seen = new SeenSet(SEEN_LIMIT);
  const startedAt = Date.now();

  let interval = floor;
  let cursor = options.cursor;
  let emitted = 0;
  let polls = 0;
  let last: T | undefined;
  let interrupted = false;
  let wake: (() => void) | undefined;

  const onSigint = () => {
    interrupted = true;
    wake?.();
  };
  process.on('SIGINT', onSigint);

  const interruptibleSleep = async (ms: number): Promise<void> => {
    if (interrupted) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        wake = undefined;
        resolve();
      };
      wake = done;
      void sleep(ms).then(done);
    });
  };

  const finish = (reason: PollReason): PollResult<T> => ({ emitted, polls, reason, cursor, last });

  try {
    for (;;) {
      let page: PollPage<T>;
      try {
        page = await options.fetchPage(cursor);
      } catch (error) {
        const retryAfter = retryAfterMsOf(error);
        if (retryAfter === undefined) throw error;
        await interruptibleSleep(Math.min(retryAfter, ceiling));
        if (interrupted) break;
        continue;
      }

      polls += 1;
      cursor = page.cursor;

      let fresh = 0;
      let stop = false;
      for (const item of page.items) {
        const key = options.key(item);
        if (seen.has(key)) continue;
        seen.add(key);
        fresh += 1;
        last = item;
        await options.onItem(item);
        emitted += 1;
        if (options.until?.(item)) {
          stop = true;
          break;
        }
      }

      if (stop) return finish('until');
      if (interrupted) break;

      interval = fresh > 0 ? floor : Math.min(ceiling, Math.round(interval * 1.5));

      if (options.timeoutMs !== undefined && Date.now() - startedAt >= options.timeoutMs) {
        return finish('timeout');
      }

      await interruptibleSleep(interval);
      if (interrupted) break;

      if (options.timeoutMs !== undefined && Date.now() - startedAt >= options.timeoutMs) {
        return finish('timeout');
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  const label = options.label ?? 'items';
  process.stderr.write(
    dim(`\nstopped. ${emitted} ${label} in ${formatDuration(Date.now() - startedAt)}, ${polls} polls\n`),
  );
  exit(ExitCode.CANCELLED);
  return finish('interrupted');
}
