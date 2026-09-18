import { describe, expect, it, vi } from 'vitest';
import { MIN_POLL_INTERVAL_MS, poll } from '../../src/core/poll.js';

interface Item {
  id: string;
}

function pagesOf(pages: Item[][]) {
  let index = 0;
  return async () => {
    const items = pages[Math.min(index, pages.length - 1)] ?? [];
    index += 1;
    return { items, cursor: { page: index } };
  };
}

describe('poll', () => {
  it('emits each item once, backs off on empty pages and resets on new ones', async () => {
    const delays: number[] = [];
    const seen: string[] = [];
    const fetchPage = pagesOf([
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'a' }],
      [],
      [{ id: 'c' }],
      [{ id: 'stop' }],
    ]);

    const result = await poll<Item>({
      fetchPage,
      key: (item) => item.id,
      intervalMs: 1_000,
      onItem: (item) => {
        seen.push(item.id);
      },
      until: (item) => item.id === 'stop',
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(seen).toEqual(['a', 'b', 'c', 'stop']);
    expect(delays).toEqual([5_000, 7_500, 11_250, 5_000]);
    expect(result.reason).toBe('until');
    expect(result.emitted).toBe(4);
    expect(result.polls).toBe(5);
    expect(result.cursor).toEqual({ page: 5 });
  });

  it('never sleeps below the five second floor', async () => {
    const delays: number[] = [];
    await poll<Item>({
      fetchPage: pagesOf([[{ id: 'a' }], [{ id: 'stop' }]]),
      key: (item) => item.id,
      intervalMs: 10,
      onItem: () => undefined,
      until: (item) => item.id === 'stop',
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(delays).toEqual([MIN_POLL_INTERVAL_MS]);
  });

  it('caps the backoff at maxIntervalMs', async () => {
    const delays: number[] = [];
    await poll<Item>({
      fetchPage: pagesOf([[], [], [], [], [{ id: 'stop' }]]),
      key: (item) => item.id,
      intervalMs: 5_000,
      maxIntervalMs: 8_000,
      onItem: () => undefined,
      until: (item) => item.id === 'stop',
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(delays).toEqual([7_500, 8_000, 8_000, 8_000]);
  });

  it('sleeps Retry-After on a 429 without counting it as an empty poll', async () => {
    const delays: number[] = [];
    let call = 0;
    const result = await poll<Item>({
      fetchPage: async () => {
        call += 1;
        if (call === 1) throw Object.assign(new Error('rate limited'), { status: 429, retryAfterSeconds: 3 });
        return { items: [{ id: 'stop' }], cursor: undefined };
      },
      key: (item) => item.id,
      intervalMs: 5_000,
      onItem: () => undefined,
      until: (item) => item.id === 'stop',
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(delays).toEqual([3_000]);
    expect(result.polls).toBe(1);
  });

  it('rethrows errors that are not rate limits', async () => {
    await expect(
      poll<Item>({
        fetchPage: async () => {
          throw Object.assign(new Error('boom'), { status: 500 });
        },
        key: (item) => item.id,
        intervalMs: 5_000,
        onItem: () => undefined,
        sleep: async () => undefined,
      }),
    ).rejects.toThrowError('boom');
  });

  it('stops on the timeout', async () => {
    let now = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const result = await poll<Item>({
        fetchPage: pagesOf([[{ id: 'a' }], []]),
        key: (item) => item.id,
        intervalMs: 5_000,
        timeoutMs: 6_000,
        onItem: () => undefined,
        sleep: async (ms) => {
          now += ms;
        },
      });
      expect(result.reason).toBe('timeout');
      expect(result.emitted).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('removes its SIGINT listener when it finishes', async () => {
    const before = process.listenerCount('SIGINT');
    await poll<Item>({
      fetchPage: pagesOf([[{ id: 'stop' }]]),
      key: (item) => item.id,
      intervalMs: 5_000,
      onItem: () => undefined,
      until: (item) => item.id === 'stop',
      sleep: async () => undefined,
    });
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});
