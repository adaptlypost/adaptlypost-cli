import { AdaptlyPost, type RequestOptions } from '@adaptlypost/sdk';

import { dim } from '../core/color.js';
import { PRODUCT, getGlobalOptions, isDebugEnabled, resolveLanguage, resolveProfile } from '../core/config.js';
import { redactToken } from '../core/credentials.js';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_ATTEMPTS,
  RATE_LIMIT_WARN_THRESHOLD,
  httpConfig,
  type HttpConfig,
  type RateLimitSnapshot,
} from '../core/http.js';
import { isQuiet } from '../core/output.js';
import { userAgent } from '../core/version.js';
import { FetchFailure, toCliError } from './errors.js';

export interface TransportSettings {
  debug: boolean;
  quiet: boolean;
}

let client: AdaptlyPost | undefined;
let clientConfig: HttpConfig | undefined;
let lastRateLimit: RateLimitSnapshot | undefined;
let rateLimitWarned = false;

export function getLastRateLimit(): RateLimitSnapshot | undefined {
  return lastRateLimit;
}

function debugLog(line: string): void {
  process.stderr.write(dim(`${line}\n`));
}

function redactedHeaders(headers: Headers): Record<string, string> {
  const copy: Record<string, string> = {};
  headers.forEach((value, key) => {
    copy[key] = key === 'authorization' ? `Bearer ${redactToken(value.replace(/^Bearer\s+/i, ''))}` : value;
  });
  return copy;
}

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function captureRateLimit(headers: Headers, settings: TransportSettings): void {
  const limit = toNumber(headers.get('ratelimit-limit') ?? headers.get('x-ratelimit-limit'));
  const remaining = toNumber(headers.get('ratelimit-remaining') ?? headers.get('x-ratelimit-remaining'));
  const reset = toNumber(headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset'));
  const policy = headers.get('ratelimit-policy') ?? undefined;
  if (limit === undefined && remaining === undefined && reset === undefined && policy === undefined) return;
  lastRateLimit = { limit, remaining, reset, ...(policy ? { policy } : {}) };
  warnOnLowRateLimit(lastRateLimit, settings);
}

function warnOnLowRateLimit({ limit, remaining, reset }: RateLimitSnapshot, settings: TransportSettings): void {
  if (rateLimitWarned) return;
  if (remaining === undefined || remaining > RATE_LIMIT_WARN_THRESHOLD) return;
  if (settings.quiet || !process.stdout.isTTY) return;
  rateLimitWarned = true;
  const total = limit === undefined ? 'the' : String(limit);
  const resets = reset === undefined ? '' : `, resets in ${Math.max(0, Math.round(reset))}s`;
  process.stderr.write(dim(`rate limit: ${remaining} of ${total} left${resets}\n`));
}

export function createTransportFetch(settings: TransportSettings, baseFetch?: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    headers.set('user-agent', userAgent(PRODUCT.id));
    const startedAt = Date.now();

    if (settings.debug) {
      debugLog(`→ ${method} ${url}`);
      debugLog(`  headers ${JSON.stringify(redactedHeaders(headers))}`);
      if (typeof init?.body === 'string') debugLog(`  body ${init.body}`);
    }

    let response: Response;
    try {
      response = await (baseFetch ?? globalThis.fetch)(input, { ...init, headers });
    } catch (error) {
      if (settings.debug) {
        const reason = error instanceof Error ? error.message : String(error);
        debugLog(`← network error after ${Date.now() - startedAt}ms: ${reason}`);
      }
      throw new FetchFailure(url, error);
    }

    captureRateLimit(response.headers, settings);
    if (settings.debug) {
      debugLog(`← ${response.status} ${response.statusText} in ${Date.now() - startedAt}ms`);
      debugLog(`  rateLimit ${JSON.stringify(lastRateLimit ?? {})}`);
    }
    return response;
  };
}

function buildClient(config: HttpConfig): AdaptlyPost {
  const profile = config.profile ?? resolveProfile(config.globals ?? getGlobalOptions());
  const language = config.language === undefined ? resolveLanguage(config.globals?.lang) : String(config.language);
  const settings: TransportSettings = {
    debug: isDebugEnabled(config.debug ?? config.globals?.debug),
    quiet: config.quiet ?? config.globals?.quiet ?? isQuiet(),
  };
  return new AdaptlyPost({
    apiKey: profile.token,
    baseUrl: profile.apiUrl,
    workspaceId: profile.workspaceId,
    language,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: MAX_ATTEMPTS - 1,
    fetch: createTransportFetch(settings),
    ...(config.sleep ? { sleep: config.sleep } : {}),
  });
}

function currentClient(): AdaptlyPost {
  const config = httpConfig();
  if (!client || clientConfig !== config) {
    client = buildClient(config);
    clientConfig = config;
    lastRateLimit = undefined;
    rateLimitWarned = false;
  }
  return client;
}

export async function callApi<T>(
  run: (api: AdaptlyPost, options: RequestOptions) => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  try {
    return await run(currentClient(), { timeoutMs });
  } catch (error) {
    throw toCliError(error, timeoutMs);
  }
}
