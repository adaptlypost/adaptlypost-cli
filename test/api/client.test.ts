import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('../../src/core/http.js', () => ({ request }));

import * as client from '../../src/api/client.js';

const lastCall = () => request.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ ok: true });
});

describe('endpoint mapping', () => {
  const cases: [string, () => Promise<unknown>, Record<string, unknown>][] = [
    ['getMe', () => client.getMe(), { method: 'GET', path: '/me' }],
    [
      'listSocialAccounts',
      () => client.listSocialAccounts(),
      { method: 'GET', path: '/social-accounts' },
    ],
    [
      'checkSocialAccount',
      () => client.checkSocialAccount('fb_page_91c'),
      {
        method: 'POST',
        path: '/social-accounts/fb_page_91c/check',
        idempotent: true,
      },
    ],
    [
      'createUploadUrls',
      () =>
        client.createUploadUrls({
          files: [{ fileName: 'hero.jpg', mimeType: 'image/jpeg' }],
        }),
      {
        method: 'POST',
        path: '/upload-urls',
        body: { files: [{ fileName: 'hero.jpg', mimeType: 'image/jpeg' }] },
      },
    ],
    [
      'listPosts',
      () => client.listPosts({ limit: 5, statuses: ['SCHEDULED'] }),
      {
        method: 'GET',
        path: '/social-posts',
        query: { limit: 5, statuses: ['SCHEDULED'] },
      },
    ],
    [
      'listPosts without arguments',
      () => client.listPosts(),
      { method: 'GET', path: '/social-posts', query: {} },
    ],
    [
      'getPost',
      () => client.getPost('post_9c3e1f'),
      { method: 'GET', path: '/social-posts/post_9c3e1f' },
    ],
    [
      'createPost',
      () =>
        client.createPost({
          platforms: ['TWITTER'],
          contentType: 'TEXT',
          timezone: 'Europe/Berlin',
          text: 'Shipping the CLI today.',
          twitterConnectionIds: ['tw_4d1b'],
        }),
      {
        method: 'POST',
        path: '/social-posts',
        body: {
          platforms: ['TWITTER'],
          contentType: 'TEXT',
          timezone: 'Europe/Berlin',
          text: 'Shipping the CLI today.',
          twitterConnectionIds: ['tw_4d1b'],
        },
      },
    ],
    [
      'updatePost',
      () => client.updatePost('post_9c3e1f', { text: 'edited' }),
      {
        method: 'PATCH',
        path: '/social-posts/post_9c3e1f',
        body: { text: 'edited' },
      },
    ],
    [
      'deletePost',
      () => client.deletePost('post_11fe03'),
      { method: 'DELETE', path: '/social-posts/post_11fe03' },
    ],
    [
      'publishDraft',
      () => client.publishDraft('post_9c3e1f', { timezone: 'UTC' }),
      {
        method: 'POST',
        path: '/social-posts/post_9c3e1f/publish',
        body: { timezone: 'UTC' },
      },
    ],
    [
      'unschedulePost',
      () => client.unschedulePost('post_9c3e1f'),
      { method: 'POST', path: '/social-posts/post_9c3e1f/unschedule' },
    ],
    [
      'listPostResults',
      () => client.listPostResults('post_9c3e1f'),
      { method: 'GET', path: '/social-posts/post_9c3e1f/results' },
    ],
    [
      'retryFailedPlatforms',
      () =>
        client.retryFailedPlatforms('post_9c3e1f', { platformIds: ['pp_9b2'] }),
      {
        method: 'POST',
        path: '/social-posts/post_9c3e1f/retry',
        body: { platformIds: ['pp_9b2'] },
      },
    ],
    [
      'bulkSchedulePosts',
      () =>
        client.bulkSchedulePosts({
          platforms: ['TWITTER'],
          timezone: 'UTC',
          posts: [{ contentType: 'TEXT', scheduledAt: '2026-09-19T09:00:00Z' }],
        }),
      {
        method: 'POST',
        path: '/social-posts/bulk',
        body: {
          platforms: ['TWITTER'],
          timezone: 'UTC',
          posts: [{ contentType: 'TEXT', scheduledAt: '2026-09-19T09:00:00Z' }],
        },
      },
    ],
    [
      'createConnectLink',
      () => client.createConnectLink(),
      { method: 'POST', path: '/connect-links' },
    ],
    [
      'revokeConnectLink',
      () => client.revokeConnectLink('7f2a9c'),
      { method: 'DELETE', path: '/connect-links/7f2a9c' },
    ],
    [
      'createWebhook',
      () => client.createWebhook({ url: 'https://example.com/hook' }),
      {
        method: 'POST',
        path: '/webhooks',
        body: { url: 'https://example.com/hook' },
      },
    ],
    [
      'listWebhooks',
      () => client.listWebhooks(),
      { method: 'GET', path: '/webhooks' },
    ],
    [
      'getWebhook',
      () => client.getWebhook('wh_3f9a'),
      { method: 'GET', path: '/webhooks/wh_3f9a' },
    ],
    [
      'updateWebhook',
      () => client.updateWebhook('wh_3f9a', { active: false }),
      {
        method: 'PATCH',
        path: '/webhooks/wh_3f9a',
        body: { active: false },
      },
    ],
    [
      'deleteWebhook',
      () => client.deleteWebhook('wh_3f9a'),
      { method: 'DELETE', path: '/webhooks/wh_3f9a' },
    ],
    [
      'testWebhook',
      () => client.testWebhook('wh_3f9a'),
      { method: 'POST', path: '/webhooks/wh_3f9a/test' },
    ],
    [
      'getAnalyticsOverview',
      () =>
        client.getAnalyticsOverview({
          from: '2026-08-19',
          to: '2026-09-18',
          platforms: ['INSTAGRAM', 'TIKTOK'],
        }),
      {
        method: 'GET',
        path: '/analytics/overview',
        query: {
          from: '2026-08-19',
          to: '2026-09-18',
          platforms: ['INSTAGRAM', 'TIKTOK'],
        },
      },
    ],
    [
      'getAnalyticsTimeseries',
      () =>
        client.getAnalyticsTimeseries({
          from: '2026-08-19',
          to: '2026-09-18',
          granularity: 'WEEKLY',
        }),
      {
        method: 'GET',
        path: '/analytics/timeseries',
        query: {
          from: '2026-08-19',
          to: '2026-09-18',
          granularity: 'WEEKLY',
        },
      },
    ],
    [
      'getPlatformBreakdown',
      () =>
        client.getPlatformBreakdown({ from: '2026-08-19', to: '2026-09-18' }),
      {
        method: 'GET',
        path: '/analytics/platform-breakdown',
        query: { from: '2026-08-19', to: '2026-09-18' },
      },
    ],
    [
      'listPostAnalytics',
      () =>
        client.listPostAnalytics({
          from: '2026-08-19',
          to: '2026-09-18',
          sortBy: 'VIEWS',
          page: 2,
          limit: 50,
        }),
      {
        method: 'GET',
        path: '/analytics/posts',
        query: {
          from: '2026-08-19',
          to: '2026-09-18',
          sortBy: 'VIEWS',
          page: 2,
          limit: 50,
        },
      },
    ],
    [
      'listTopPosts',
      () =>
        client.listTopPosts({
          from: '2026-08-19',
          to: '2026-09-18',
          limit: 10,
        }),
      {
        method: 'GET',
        path: '/analytics/top-posts',
        query: { from: '2026-08-19', to: '2026-09-18', limit: 10 },
      },
    ],
    [
      'listDiscoveredPosts',
      () =>
        client.listDiscoveredPosts({
          from: '2026-08-19',
          to: '2026-09-18',
          limit: 200,
        }),
      {
        method: 'GET',
        path: '/analytics/discovered-posts',
        query: { from: '2026-08-19', to: '2026-09-18', limit: 200 },
      },
    ],
    [
      'getAnalyticsSyncStatus',
      () => client.getAnalyticsSyncStatus(),
      { method: 'GET', path: '/analytics/sync-status' },
    ],
    [
      'triggerAnalyticsSync',
      () => client.triggerAnalyticsSync(),
      { method: 'POST', path: '/analytics/sync', idempotent: true },
    ],
    [
      'generateCaption',
      () => client.generateCaption({ prompt: 'launch', platform: 'TWITTER' }),
      {
        method: 'POST',
        path: '/ai/captions',
        body: { prompt: 'launch', platform: 'TWITTER' },
      },
    ],
    [
      'refineCaption',
      () =>
        client.refineCaption({
          prompt: 'shorter',
          originalText: 'a long caption',
        }),
      {
        method: 'POST',
        path: '/ai/captions/refine',
        body: { prompt: 'shorter', originalText: 'a long caption' },
      },
    ],
    [
      'generateImage',
      () => client.generateImage({ prompt: 'a terminal', aspectRatio: '16:9' }),
      {
        method: 'POST',
        path: '/ai/images',
        body: { prompt: 'a terminal', aspectRatio: '16:9' },
      },
    ],
    [
      'getImageJob',
      () => client.getImageJob('job_5a1c'),
      { method: 'GET', path: '/ai/images/job_5a1c' },
    ],
  ];

  it.each(cases)('%s', async (_name, call, expected) => {
    await call();

    expect(request).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual(expected);
  });
});

describe('path building', () => {
  it('encodes ids into a single path segment', async () => {
    await client.getPost('post 9c3e/1f');

    expect(lastCall().path).toBe('/social-posts/post%209c3e%2F1f');
  });

  it('never sends an absolute url as the path', async () => {
    await client.listSocialAccounts();
    await client.listWebhooks();
    await client.getAnalyticsSyncStatus();

    for (const [opts] of request.mock.calls) {
      expect(opts.path).toMatch(/^\//);
    }
  });
});

describe('return value', () => {
  it('passes the parsed response through untouched', async () => {
    const accounts = { accounts: [{ id: 'ig_7f2a' }] };
    request.mockResolvedValueOnce(accounts);

    await expect(client.listSocialAccounts()).resolves.toBe(accounts);
  });
});
