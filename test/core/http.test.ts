import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedProfile } from '../../src/core/config.js';
import {
  buildUrl,
  configureHttp,
  getLastRateLimit,
  parseRetryAfter,
  request,
  resetHttp,
  timeoutForRequest,
} from '../../src/core/http.js';

const profile: ResolvedProfile = {
  name: 'default',
  token: 'adaptly_ab12cd34',
  tokenSource: 'credentials',
  apiUrl: 'https://post.example.test/post/api/v1',
  defaults: {},
};

const delays: number[] = [];
const fetchMock = vi.fn();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  delays.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
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
});

describe('buildUrl', () => {
  it('repeats the key for array params and drops null and undefined', () => {
    const url = buildUrl(profile.apiUrl, '/social-posts', {
      statuses: ['NEW', 'APPROVED'],
      limit: 20,
      draft: false,
      cursor: undefined,
      after: null,
    });
    expect(url).toBe(
      'https://post.example.test/post/api/v1/social-posts?statuses=NEW&statuses=APPROVED&limit=20&draft=false',
    );
  });
});

describe('timeouts', () => {
  it('gives AI and explain endpoints the long timeout', () => {
    expect(timeoutForRequest('GET', '/social-posts')).toBe(30_000);
    expect(timeoutForRequest('POST', '/ai/captions')).toBe(120_000);
    expect(timeoutForRequest('POST', '/mentions/8f2c/explain')).toBe(120_000);
    expect(timeoutForRequest('POST', '/social-posts')).toBe(30_000);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('not-a-date')).toBeUndefined();
    const now = Date.now();
    expect(parseRetryAfter(new Date(now + 2000).toUTCString(), now)).toBeGreaterThan(0);
  });
});

describe('request', () => {
  it('refuses an absolute URL as a path', async () => {
    await expect(request({ method: 'GET', path: 'https://evil.test/steal' })).rejects.toThrowError(/relative/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the auth, accept and user-agent headers', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    configureHttp({ profile, language: 'fr' });

    await request({ method: 'GET', path: '/social-accounts' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe('Bearer adaptly_ab12cd34');
    expect(init.headers.accept).toBe('application/json');
    expect(init.headers['user-agent']).toMatch(/^adaptlypost-cli\//);
    expect(init.headers['x-language']).toBe('fr');
    expect(init.body).toBeUndefined();
  });

  it('serialises a JSON body for writes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'post_1' }, { status: 201 }));
    await request({ method: 'POST', path: '/social-posts', body: { content: 'hello' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ content: 'hello' });
  });

  it('captures the RateLimit headers', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { data: [] },
        {
          headers: {
            'content-type': 'application/json',
            'ratelimit-limit': '600',
            'ratelimit-remaining': '598',
            'ratelimit-reset': '41',
            'ratelimit-policy': '600;w=60',
          },
        },
      ),
    );
    await request({ method: 'GET', path: '/social-accounts' });
    expect(getLastRateLimit()).toEqual({ limit: 600, remaining: 598, reset: 41, policy: '600;w=60' });
  });

  it('honours Retry-After on 429 and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('{"message":"Too many requests"}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: ['ok'] }));

    const result = await request<{ data: string[] }>({ method: 'GET', path: '/social-posts' });

    expect(result.data).toEqual(['ok']);
    expect(delays).toEqual([2000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 429 on a write', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"message":"Too many requests"}', {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '2' },
      }),
    );

    await expect(request({ method: 'POST', path: '/social-posts', body: {} })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 503 up to three attempts and then throws', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 503 }));
    await expect(request({ method: 'GET', path: '/social-posts' })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toHaveLength(2);
  });

  it('retries network failures and surfaces exit code 8', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(request({ method: 'GET', path: '/social-posts' })).rejects.toMatchObject({ exitCode: 8 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('flattens a NestJS validation message array', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: ['content must be a string', 'content should not be empty'] }), {
        status: 400,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_123' },
      }),
    );

    await expect(request({ method: 'POST', path: '/social-posts', body: {} })).rejects.toMatchObject({
      status: 400,
      code: 'bad_request',
      message: 'content must be a string; content should not be empty',
      requestId: 'req_123',
    });
  });

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(request({ method: 'DELETE', path: '/social-posts/post_1' })).resolves.toBeUndefined();
  });
});
