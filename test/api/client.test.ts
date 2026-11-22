import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as client from '../../src/api/client.js';
import type { ResolvedProfile } from '../../src/core/config.js';
import { configureHttp, resetHttp } from '../../src/core/http.js';

const profile: ResolvedProfile = {
  name: 'default',
  token: 'adaptly_ab12cd34',
  tokenSource: 'credentials',
  apiUrl: 'https://post.example.test/post/api/v1',
  defaults: {},
};

const fetchMock = vi.fn<typeof fetch>();

interface SentRequest {
  method: string;
  path: string;
  query?: Record<string, string | string[]>;
  body?: unknown;
}

function sent(index = -1): SentRequest {
  const call = fetchMock.mock.calls.at(index);
  if (!call) throw new Error('fetch was not called');
  const [input, init] = call;
  const url = new URL(String(input));
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return {
    method: init?.method ?? 'GET',
    path: url.pathname.replace('/post/api/v1', ''),
    ...(Object.keys(query).length > 0 && { query }),
    ...(typeof init?.body === 'string' && { body: JSON.parse(init.body) }),
  };
}

function expectedRequest(expected: Record<string, unknown>): SentRequest {
  const { method, path, query, body } = expected;
  const flat: Record<string, string | string[]> = {};
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      flat[key] = Array.isArray(value) ? (value.length > 1 ? value.map(String) : String(value[0])) : String(value);
    }
  }
  return {
    method: String(method),
    path: String(path),
    ...(Object.keys(flat).length > 0 && { query: flat }),
    ...(body !== undefined && { body }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  configureHttp({ profile, sleep: async () => undefined });
});

afterEach(() => {
  resetHttp();
  vi.unstubAllGlobals();
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
      },
    ],
    [
      'removeSocialAccount',
      () => client.removeSocialAccount('fb_page_91c'),
      { method: 'DELETE', path: '/social-accounts/fb_page_91c' },
    ],
    [
      'listPinterestBoards',
      () => client.listPinterestBoards('pin_3c1d'),
      { method: 'GET', path: '/social-accounts/pin_3c1d/pinterest-boards' },
    ],
    [
      'listYouTubePlaylists',
      () => client.listYouTubePlaylists('yt_8f4b'),
      { method: 'GET', path: '/social-accounts/yt_8f4b/youtube-playlists' },
    ],
    [
      'listWordPressCategories',
      () => client.listWordPressCategories('wp_7e2a'),
      { method: 'GET', path: '/social-accounts/wp_7e2a/wordpress-categories' },
    ],
    [
      'lookupLinkedInOrganization',
      () => client.lookupLinkedInOrganization({ query: 'https://www.linkedin.com/company/devtestco/' }),
      {
        method: 'GET',
        path: '/linkedin-organizations/lookup',
        query: { query: 'https://www.linkedin.com/company/devtestco/' },
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
      'publishDraft with publishNow',
      () => client.publishDraft('post_9c3e1f', { timezone: 'UTC', publishNow: true }),
      {
        method: 'POST',
        path: '/social-posts/post_9c3e1f/publish',
        body: { timezone: 'UTC', publishNow: true },
      },
    ],
    [
      'unschedulePost',
      () => client.unschedulePost('post_9c3e1f'),
      { method: 'POST', path: '/social-posts/post_9c3e1f/unschedule' },
    ],
    [
      'listRecurringPosts',
      () => client.listRecurringPosts({ limit: 5, statuses: ['ACTIVE', 'PAUSED'] }),
      {
        method: 'GET',
        path: '/recurring-posts',
        query: { limit: 5, statuses: ['ACTIVE', 'PAUSED'] },
      },
    ],
    [
      'getRecurringPost',
      () => client.getRecurringPost('rp_4a2c'),
      { method: 'GET', path: '/recurring-posts/rp_4a2c' },
    ],
    [
      'pauseRecurringPost',
      () => client.pauseRecurringPost('rp_4a2c'),
      { method: 'POST', path: '/recurring-posts/rp_4a2c/pause' },
    ],
    [
      'resumeRecurringPost',
      () => client.resumeRecurringPost('rp_4a2c'),
      { method: 'POST', path: '/recurring-posts/rp_4a2c/resume' },
    ],
    [
      'deleteRecurringPost',
      () => client.deleteRecurringPost('rp_4a2c'),
      { method: 'DELETE', path: '/recurring-posts/rp_4a2c' },
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
      () => client.createConnectLink({ name: 'Acme', neverExpires: true, returnUrl: 'https://app.example.com/connected' }),
      {
        method: 'POST',
        path: '/connect-links',
        body: { name: 'Acme', neverExpires: true, returnUrl: 'https://app.example.com/connected' },
      },
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
    ['listWorkspaces', () => client.listWorkspaces(), { method: 'GET', path: '/workspaces' }],
    [
      'createWorkspace',
      () => client.createWorkspace({ name: 'Client B', connectionLimit: 5 }),
      { method: 'POST', path: '/workspaces', body: { name: 'Client B', connectionLimit: 5 } },
    ],
    [
      'deleteWorkspace',
      () => client.deleteWorkspace('ws_2b7d'),
      { method: 'DELETE', path: '/workspaces/ws_2b7d' },
    ],
    ['listMembers', () => client.listMembers(), { method: 'GET', path: '/members' }],
    [
      'removeMember',
      () => client.removeMember('user_4c1e'),
      { method: 'DELETE', path: '/members/user_4c1e' },
    ],
    [
      'removeOrganizationMember',
      () => client.removeOrganizationMember('user_4c1e'),
      { method: 'DELETE', path: '/organization/members/user_4c1e' },
    ],
    [
      'listInvitations',
      () => client.listInvitations({ limit: 10, offset: 20 }),
      { method: 'GET', path: '/invitations', query: { limit: 10, offset: 20 } },
    ],
    [
      'sendInvitation',
      () =>
        client.sendInvitation({
          email: 'ana@example.com',
          workspaces: [{ workspaceId: 'ws_2b7d', role: 'editor' }],
        }),
      {
        method: 'POST',
        path: '/invitations',
        body: { email: 'ana@example.com', workspaces: [{ workspaceId: 'ws_2b7d', role: 'editor' }] },
      },
    ],
    [
      'revokeInvitation',
      () => client.revokeInvitation('inv_8e3a'),
      { method: 'DELETE', path: '/invitations/inv_8e3a' },
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
      { method: 'POST', path: '/analytics/sync' },
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(expectedRequest(expected));
  });
});

describe('path building', () => {
  it('encodes ids into a single path segment', async () => {
    await client.getPost('post 9c3e/1f');

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://post.example.test/post/api/v1/social-posts/post%209c3e%2F1f',
    );
  });
});

describe('request headers', () => {
  it('sends the token, language, workspace and user agent', async () => {
    configureHttp({ profile: { ...profile, workspaceId: 'ws_9c3e1f' }, language: 'fr' });

    await client.listSocialAccounts();

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer adaptly_ab12cd34');
    expect(headers.get('x-language')).toBe('fr');
    expect(headers.get('x-workspace-id')).toBe('ws_9c3e1f');
    expect(headers.get('user-agent')).toMatch(/-cli\//);
  });
});

describe('post bodies', () => {
  it('leaves out the imageLayout and WordPress status the CLI did not set', async () => {
    await client.updatePost('post_9c3e1f', {
      facebookConfigs: [{ pageId: 'fb_1', postType: 'REEL' }],
      wordpressConfigs: [{ connectionId: 'wp_1', title: 'Hi' }],
    });

    expect(sent().body).toEqual({
      facebookConfigs: [{ pageId: 'fb_1', postType: 'REEL' }],
      wordpressConfigs: [{ connectionId: 'wp_1', title: 'Hi' }],
    });
  });

  it('keeps the values the CLI set, in bulk posts too', async () => {
    await client.bulkSchedulePosts({
      platforms: ['FACEBOOK'],
      timezone: 'UTC',
      pageIds: ['fb_1'],
      facebookConfigs: [{ pageId: 'fb_1', imageLayout: 'CAROUSEL' }],
      posts: [
        {
          contentType: 'TEXT',
          scheduledAt: '2026-09-19T09:00:00Z',
          wordpressConfigs: [{ connectionId: 'wp_1', status: 'DRAFT' }],
        },
      ],
    });

    expect(sent().body).toEqual({
      platforms: ['FACEBOOK'],
      timezone: 'UTC',
      pageIds: ['fb_1'],
      facebookConfigs: [{ pageId: 'fb_1', imageLayout: 'CAROUSEL' }],
      posts: [
        {
          contentType: 'TEXT',
          scheduledAt: '2026-09-19T09:00:00Z',
          wordpressConfigs: [{ connectionId: 'wp_1', status: 'DRAFT' }],
        },
      ],
    });
  });
});

describe('return value', () => {
  it('passes the parsed response through', async () => {
    const accounts = { accounts: [{ id: 'ig_7f2a' }] };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(accounts), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    await expect(client.listSocialAccounts()).resolves.toEqual(accounts);
  });
});
