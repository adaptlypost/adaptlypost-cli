import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', () => ({
  getAnalyticsOverview: vi.fn(),
  getAnalyticsSyncStatus: vi.fn(),
  getAnalyticsTimeseries: vi.fn(),
  getPlatformBreakdown: vi.fn(),
  listDiscoveredPosts: vi.fn(),
  listPostAnalytics: vi.fn(),
  listTopPosts: vi.fn(),
  triggerAnalyticsSync: vi.fn(),
}));

const client = await import('../../src/api/client.js');
const { registerAnalyticsCommands } = await import('../../src/commands/analytics.js');
const { initOutput } = await import('../../src/core/output.js');

let written: string[] = [];

const run = (argv: string[]): Promise<unknown> => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerAnalyticsCommands(program);
  return program.parseAsync(argv, { from: 'user' });
};

const stdoutJson = (): Record<string, unknown> => JSON.parse(written.join('')) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  written = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  initOutput({ json: true });
});

describe('analytics top', () => {
  it('asks for the top posts by the chosen metric', async () => {
    vi.mocked(client.listTopPosts).mockResolvedValue({ posts: [] });

    await run([
      'analytics', 'top', '--from', '2026-08-01', '--to', '2026-09-01',
      '--sort-by', 'likes', '--limit', '5', '--platform', 'INSTAGRAM',
    ]);

    expect(client.listTopPosts).toHaveBeenCalledWith({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      platforms: ['INSTAGRAM'],
      sortBy: 'LIKES',
      limit: 5,
    });
    expect(stdoutJson()).toMatchObject({ ok: true, command: 'analytics.top', data: [], meta: { sortBy: 'LIKES', limit: 5 } });
  });

  it('refuses a limit above the endpoint maximum of 50', async () => {
    await expect(run(['analytics', 'top', '--limit', '51'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.listTopPosts).not.toHaveBeenCalled();
  });
});

describe('analytics discovered', () => {
  it('lists posts published outside AdaptlyPost', async () => {
    const posts = [
      {
        id: 'd1',
        platform: 'INSTAGRAM' as const,
        publishedAt: '2026-08-20T10:00:00.000Z',
        text: 'Posted from the app',
        thumbnailUrl: null,
        permalink: 'https://instagram.com/p/1',
        accountName: 'acme',
      },
    ];
    vi.mocked(client.listDiscoveredPosts).mockResolvedValue({ posts });

    await run(['analytics', 'discovered', '--from', '2026-08-01', '--to', '2026-09-01']);

    expect(client.listDiscoveredPosts).toHaveBeenCalledWith({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      platforms: undefined,
      limit: 200,
    });
    expect(stdoutJson()).toMatchObject({ command: 'analytics.discovered', data: posts, meta: { total: 1 } });
  });

  it('refuses a limit above 1000', async () => {
    await expect(run(['analytics', 'discovered', '--limit', '1001'])).rejects.toMatchObject({ exitCode: 2 });
  });
});
