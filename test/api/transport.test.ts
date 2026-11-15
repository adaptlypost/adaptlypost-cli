import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMe, getPost, listSocialAccounts, createPost } from '../../src/api/client.js';
import { getLastRateLimit } from '../../src/api/transport.js';
import type { ResolvedProfile } from '../../src/core/config.js';
import { ApiError, CliError } from '../../src/core/errors.js';
import { ExitCode } from '../../src/core/exit-codes.js';
import { configureHttp, resetHttp } from '../../src/core/http.js';

const profile: ResolvedProfile = {
  name: 'default',
  token: 'adaptly_ab12cd34ef56gh78',
  tokenSource: 'credentials',
  apiUrl: 'https://post.example.test/post/api/v1',
  defaults: {},
};

const fetchMock = vi.fn<typeof fetch>();
const delays: number[] = [];
let stderr = '';
let stdoutIsTty: boolean | undefined;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

beforeEach(() => {
  delays.length = 0;
  stderr = '';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  });
  stdoutIsTty = process.stdout.isTTY;
  configureHttp({
    profile,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  });
});

afterEach(() => {
  resetHttp();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.stdout.isTTY = stdoutIsTty ?? false;
});

describe('debug logging', () => {
  it('logs each request and response with the token redacted', async () => {
    configureHttp({ profile, debug: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'post_1' }));

    await createPost({ platforms: ['TWITTER'], contentType: 'TEXT', timezone: 'UTC', text: 'hi' });

    expect(stderr).toContain('→ POST https://post.example.test/post/api/v1/social-posts');
    expect(stderr).toContain('"text":"hi"');
    expect(stderr).toContain('← 200');
    expect(stderr).toContain('authorization');
    expect(stderr).not.toContain(profile.token);
  });

  it('stays silent without --debug', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'post_1' }));

    await getPost('post_1');

    expect(stderr).toBe('');
  });
});

describe('rate limits', () => {
  it('records the last rate-limit headers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { accounts: [] },
        {
          headers: {
            'ratelimit-limit': '600',
            'ratelimit-remaining': '598',
            'ratelimit-reset': '41',
            'ratelimit-policy': '600;w=60',
          },
        },
      ),
    );

    await listSocialAccounts();

    expect(getLastRateLimit()).toEqual({ limit: 600, remaining: 598, reset: 41, policy: '600;w=60' });
  });

  it('warns once when few requests are left on a terminal', async () => {
    process.stdout.isTTY = true;
    const low = { headers: { 'ratelimit-limit': '600', 'ratelimit-remaining': '7', 'ratelimit-reset': '30' } };
    fetchMock.mockResolvedValueOnce(jsonResponse({ accounts: [] }, low));
    fetchMock.mockResolvedValueOnce(jsonResponse({ accounts: [] }, low));

    await listSocialAccounts();
    await listSocialAccounts();

    expect(stderr.match(/rate limit: 7 of 600 left, resets in 30s/g)).toHaveLength(1);
  });

  it('does not warn under --quiet', async () => {
    process.stdout.isTTY = true;
    configureHttp({ profile, quiet: true });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ accounts: [] }, { headers: { 'ratelimit-remaining': '3' } }),
    );

    await listSocialAccounts();

    expect(stderr).toBe('');
  });
});

describe('error mapping', () => {
  it('turns a permission refusal into an ApiError with the forbidden exit code and the request id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 403,
          code: 'permission_denied',
          requiredPermission: 'posts.publish',
          role: 'contributor',
          keyRole: 'contributor',
          tokenType: 'api_token',
          message: 'Your role cannot publish posts',
        },
        { status: 403, headers: { 'x-request-id': 'req_42' } },
      ),
    );

    const error = await rejection(getPost('post_1'));

    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.status).toBe(403);
    expect(error.code).toBe('permission_denied');
    expect(error.exitCode).toBe(ExitCode.FORBIDDEN);
    expect(error.requestId).toBe('req_42');
    expect(error.method).toBe('GET');
    expect(error.path).toBe('/social-posts/post_1');
    expect(error.message).toBe('Your role cannot publish posts');
    expect(error.hint).toContain('posts.publish');
  });

  it('keeps the issues of a refused post in the body', async () => {
    const issues = [{ code: 'TEXT_TOO_LONG', severity: 'ERROR', message: 'Too long for X', platform: 'TWITTER' }];
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 400, code: 'post_validation_failed', message: 'The post was refused', issues },
        { status: 400 },
      ),
    );

    const error = await rejection(createPost({ platforms: ['TWITTER'], contentType: 'TEXT', timezone: 'UTC' }));

    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.code).toBe('post_validation_failed');
    expect(error.exitCode).toBe(ExitCode.VALIDATION);
    expect(error.body).toMatchObject({ issues });
  });

  it('maps a plan refusal to the quota exit code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'subscription_required', message: 'No plan' }, { status: 403 }),
    );

    const error = await rejection(getMe());

    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.exitCode).toBe(ExitCode.QUOTA);
  });

  it('retries a 503 on a read and returns the later answer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'busy' }, { status: 503, headers: { 'retry-after': '2' } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'post_1' }));

    await expect(getPost('post_1')).resolves.toEqual({ id: 'post_1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
  });

  it('gives up after three attempts', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ message: 'down' }, { status: 502 }));

    const error = await rejection(getPost('post_1'));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.exitCode).toBe(ExitCode.GENERIC);
  });

  it('turns an unreachable host into a network error with the url', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const error = await rejection(getPost('post_1'));

    expect(error).toBeInstanceOf(CliError);
    if (!(error instanceof CliError)) return;
    expect(error.exitCode).toBe(ExitCode.NETWORK);
    expect(error.message).toBe(
      'Could not reach https://post.example.test/post/api/v1/social-posts/post_1: fetch failed',
    );
    expect(error.hint).toContain('--api-url');
  });
});
