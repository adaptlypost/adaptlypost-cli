import { dim, yellow } from './color.js';
import { PRODUCT, envVar, readConfig, updateConfig, type ConfigFile } from './config.js';
import { VERSION } from './version.js';

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 2_000;
export const REGISTRY_URL = 'https://registry.npmjs.org';

export interface UpdateNotice {
  current: string;
  latest: string;
}

export function compareSemver(a: string, b: string): number {
  const split = (value: string) => {
    const [core, pre] = value.replace(/^v/, '').split('-', 2);
    const parts = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
    return { parts, pre: pre ?? '' };
  };
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === '') return 1;
  if (right.pre === '') return -1;
  return left.pre < right.pre ? -1 : 1;
}

export async function fetchLatestVersion(
  packageName = PRODUCT.npmPackage,
  timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
): Promise<string | undefined> {
  const response = await fetch(`${REGISTRY_URL}/${packageName.replace('/', '%2f')}/latest`, {
    headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { version?: unknown };
  return typeof body.version === 'string' ? body.version : undefined;
}

export interface UpdateCheckOptions {
  quiet?: boolean;
  force?: boolean;
  now?: number;
}

function skip(options: UpdateCheckOptions): boolean {
  if (options.quiet) return true;
  if (process.env.CI) return true;
  if (process.env[envVar('NO_UPDATE_CHECK')]) return true;
  if (options.force) return false;
  if (!process.stdout.isTTY) return true;
  return false;
}

export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateNotice | undefined> {
  if (skip(options)) return undefined;

  const now = options.now ?? Date.now();
  let config: ConfigFile;
  try {
    config = readConfig();
  } catch {
    return undefined;
  }
  if (config.updateCheck === false) return undefined;

  const cached = config.lastUpdateCheck;
  const checkedAt = cached?.checked ? Date.parse(cached.checked) : Number.NaN;
  const fresh = !options.force && Number.isFinite(checkedAt) && now - checkedAt < UPDATE_CHECK_INTERVAL_MS;

  let latest = fresh ? cached?.latest : undefined;
  if (!fresh) {
    let fetched: string | undefined;
    try {
      fetched = await fetchLatestVersion();
    } catch {
      return undefined;
    }
    if (!fetched) return undefined;
    latest = fetched;
    const entry = { checked: new Date(now).toISOString(), latest: fetched };
    try {
      updateConfig((next) => {
        next.lastUpdateCheck = entry;
      });
    } catch {
      return undefined;
    }
  }

  if (!latest) return undefined;
  if (compareSemver(latest, VERSION) <= 0) return undefined;
  return { current: VERSION, latest };
}

export function printUpdateNotice(notice: UpdateNotice): void {
  process.stderr.write(
    `${yellow(`A new version of ${PRODUCT.binName} is available: ${notice.latest}`)} ${dim(
      `(you have ${notice.current})`,
    )}\n`,
  );
  process.stderr.write(
    dim(
      `Update: npm i -g ${PRODUCT.npmPackage}   ·   disable: ${PRODUCT.binName} config set updateCheck false\n`,
    ),
  );
}

export async function runUpdateCheck(options: UpdateCheckOptions = {}): Promise<void> {
  try {
    const notice = await checkForUpdate(options);
    if (notice) printUpdateNotice(notice);
  } catch {
    return;
  }
}
