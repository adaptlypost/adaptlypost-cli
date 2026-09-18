import { dim } from './color.js';
import { ApiError, CliError, networkError } from './errors.js';
import { ExitCode } from './exit-codes.js';
import { isQuiet } from './output.js';
import {
  PRODUCT,
  getGlobalOptions,
  isDebugEnabled,
  resolveLanguage,
  resolveProfile,
  type GlobalOptions,
  type Language,
  type ResolvedProfile,
} from './config.js';
import { redactToken } from './credentials.js';
import { userAgent } from './version.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean | string[] | undefined | null;

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  idempotent?: boolean;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface RateLimitSnapshot {
  limit?: number;
  remaining?: number;
  reset?: number;
  policy?: string;
}

export interface HttpConfig {
  profile?: ResolvedProfile;
  globals?: GlobalOptions;
  debug?: boolean;
  language?: Language | string;
  quiet?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const LONG_TIMEOUT_MS = 120_000;
export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_MS = 1_000;
export const MAX_RETRY_AFTER_MS = 60_000;
export const RATE_LIMIT_WARN_THRESHOLD = 20;

const LONG_TIMEOUT_PATHS = [/^\/ai\//, /^\/mentions\/[^/]+\/explain$/];

let config: HttpConfig = {};
let resolvedProfile: ResolvedProfile | undefined;
let resolvedLanguage: string | undefined;
let lastRateLimit: RateLimitSnapshot | undefined;
let rateLimitWarned = false;

function isHttpConfig(value: HttpConfig | GlobalOptions): value is HttpConfig {
  const candidate = value as HttpConfig;
  return (
    typeof candidate.profile === 'object' || candidate.globals !== undefined || candidate.sleep !== undefined
  );
}

export function configureHttp(options: HttpConfig | GlobalOptions = getGlobalOptions()): void {
  config = isHttpConfig(options) ? { ...options } : { globals: options };
  resolvedProfile = config.profile;
  resolvedLanguage = undefined;
  rateLimitWarned = false;
}

export function httpConfig(): HttpConfig {
  return config;
}

export function resetHttp(): void {
  config = {};
  resolvedProfile = undefined;
  resolvedLanguage = undefined;
  lastRateLimit = undefined;
  rateLimitWarned = false;
}

function currentProfile(): ResolvedProfile {
  if (!resolvedProfile) resolvedProfile = resolveProfile(config.globals ?? getGlobalOptions());
  return resolvedProfile;
}

function currentLanguage(): string | undefined {
  if (config.language !== undefined) return String(config.language);
  if (resolvedLanguage === undefined) resolvedLanguage = resolveLanguage(config.globals?.lang) ?? '';
  return resolvedLanguage === '' ? undefined : resolvedLanguage;
}

function debugEnabled(): boolean {
  return isDebugEnabled(config.debug ?? config.globals?.debug);
}

function quietEnabled(): boolean {
  return config.quiet ?? config.globals?.quiet ?? isQuiet();
}

export function getLastRateLimit(): RateLimitSnapshot | undefined {
  return lastRateLimit;
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${suffix}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.append(key, String(value));
  }
  return url.toString();
}

export function timeoutForRequest(method: HttpMethod, path: string): number {
  if (method === 'POST' && LONG_TIMEOUT_PATHS.some((pattern) => pattern.test(path))) {
    return LONG_TIMEOUT_MS;
  }
  return DEFAULT_TIMEOUT_MS;
}

export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const raw = header.trim();
  if (raw === '') return undefined;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

function backoffMs(attempt: number): number {
  const base = RETRY_BASE_MS * 2 ** (attempt - 1);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function captureRateLimit(headers: Headers): void {
  const limit = toNumber(headers.get('ratelimit-limit') ?? headers.get('x-ratelimit-limit'));
  const remaining = toNumber(headers.get('ratelimit-remaining') ?? headers.get('x-ratelimit-remaining'));
  const reset = toNumber(headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset'));
  const policy = headers.get('ratelimit-policy') ?? undefined;
  if (limit === undefined && remaining === undefined && reset === undefined && policy === undefined) return;
  lastRateLimit = { limit, remaining, reset, ...(policy ? { policy } : {}) };
  warnOnLowRateLimit();
}

function warnOnLowRateLimit(): void {
  if (rateLimitWarned || !lastRateLimit) return;
  const { limit, remaining, reset } = lastRateLimit;
  if (remaining === undefined || remaining > RATE_LIMIT_WARN_THRESHOLD) return;
  if (quietEnabled() || !process.stdout.isTTY) return;
  rateLimitWarned = true;
  const total = limit === undefined ? 'the' : String(limit);
  const resets = reset === undefined ? '' : `, resets in ${Math.max(0, Math.round(reset))}s`;
  process.stderr.write(dim(`rate limit: ${remaining} of ${total} left${resets}\n`));
}

function redactedHeaders(headers: Record<string, string>): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    copy[key] = key.toLowerCase() === 'authorization' ? `Bearer ${redactToken(value.replace(/^Bearer\s+/i, ''))}` : value;
  }
  return copy;
}

function debugLog(line: string): void {
  process.stderr.write(dim(line.endsWith('\n') ? line : `${line}\n`));
}

function requestIdOf(headers: Headers): string | undefined {
  return headers.get('x-request-id') ?? headers.get('x-requestid') ?? headers.get('request-id') ?? undefined;
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text === '') return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

function toNetworkError(error: unknown, url: string, timeoutMs: number): CliError {
  const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  return isTimeout
    ? networkError(`Request to ${url} timed out after ${Math.round(timeoutMs / 1000)}s`, error)
    : networkError(
        `Could not reach ${url}: ${(error as Error).message}`,
        error,
        'Check your network connection, a proxy, or --api-url',
      );
}

export async function request<T>(options: RequestOptions): Promise<T> {
  if (/^https?:/i.test(options.path)) {
    throw new CliError(`path must be relative to the API base URL, got "${options.path}"`, {
      exitCode: ExitCode.USAGE,
    });
  }

  const profile = currentProfile();
  const debug = debugEnabled();
  const language = currentLanguage();
  const sleep = config.sleep ?? defaultSleep;
  const idempotent = options.idempotent ?? options.method === 'GET';
  const timeoutMs = options.timeoutMs ?? timeoutForRequest(options.method, options.path);
  const url = buildUrl(profile.apiUrl, options.path, options.query);

  const headers: Record<string, string> = {
    authorization: `Bearer ${profile.token}`,
    accept: 'application/json',
    'user-agent': userAgent(PRODUCT.id),
    ...(language ? { 'x-language': language } : {}),
    ...options.headers,
  };
  const hasBody = options.body !== undefined && options.method !== 'GET';
  if (hasBody) headers['content-type'] = 'application/json';

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    if (debug) {
      debugLog(`→ ${options.method} ${url} (attempt ${attempt}/${MAX_ATTEMPTS}, timeout ${timeoutMs}ms)`);
      debugLog(`  headers ${JSON.stringify(redactedHeaders(headers))}`);
      if (hasBody) debugLog(`  body ${JSON.stringify(options.body)}`);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = toNetworkError(error, url, timeoutMs);
      if (debug) debugLog(`← network error after ${Date.now() - startedAt}ms: ${(error as Error).message}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }

    captureRateLimit(response.headers);
    const body = await parseResponse(response);

    if (debug) {
      debugLog(`← ${response.status} ${response.statusText} in ${Date.now() - startedAt}ms`);
      debugLog(`  rateLimit ${JSON.stringify(lastRateLimit ?? {})}`);
    }

    if (response.ok) return body as T;

    const apiError = new ApiError({
      status: response.status,
      body,
      requestId: requestIdOf(response.headers),
      method: options.method,
      path: options.path,
    });

    const retryable =
      response.status === 429
        ? idempotent
        : response.status === 502 || response.status === 503 || response.status === 504;

    if (!retryable || attempt === MAX_ATTEMPTS) throw apiError;

    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    const delay = retryAfter ?? backoffMs(attempt);
    if (delay > MAX_RETRY_AFTER_MS) throw apiError;
    await sleep(delay);
    lastError = apiError;
  }

  throw lastError ?? new CliError('Request failed', { exitCode: ExitCode.GENERIC });
}
