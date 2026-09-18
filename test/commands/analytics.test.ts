import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import {
  assertBreakdownHasNoPlatformFilter,
  formatChange,
  formatCount,
  formatRate,
  normalizeGranularity,
  normalizeSortMetric,
  registerAnalyticsCommands,
  resolveDateRange,
  sparkline,
  summarizeSeries,
} from '../../src/commands/analytics.js';

const buildProgram = (): Command => {
  const program = new Command();
  program.exitOverride();
  registerAnalyticsCommands(program);
  return program;
};

const analyticsCommand = (program: Command): Command =>
  program.commands.find((command) => command.name() === 'analytics') as Command;

const subcommand = (program: Command, name: string): Command =>
  analyticsCommand(program).commands.find((command) => command.name() === name) as Command;

const optionNames = (command: Command): string[] =>
  command.options.map((option) => option.long ?? option.short ?? '');

describe('registerAnalyticsCommands', () => {
  it('registers the analytics noun with its verbs', () => {
    const program = buildProgram();

    expect(analyticsCommand(program).commands.map((command) => command.name())).toEqual([
      'overview',
      'timeseries',
      'breakdown',
      'posts',
      'sync-status',
      'sync',
    ]);
  });

  it('aliases breakdown as platforms and sync-status as status', () => {
    const program = buildProgram();

    expect(subcommand(program, 'breakdown').aliases()).toContain('platforms');
    expect(subcommand(program, 'sync-status').aliases()).toContain('status');
  });

  it('gives every reporting verb a date range and a platform filter', () => {
    const program = buildProgram();

    for (const name of ['overview', 'timeseries', 'breakdown', 'posts']) {
      expect(optionNames(subcommand(program, name))).toEqual(
        expect.arrayContaining(['--from', '--to', '--platform']),
      );
    }
  });

  it('gives posts its sorting and paging flags', () => {
    const program = buildProgram();

    expect(optionNames(subcommand(program, 'posts'))).toEqual(
      expect.arrayContaining(['--sort-by', '--page', '--limit', '--all']),
    );
  });

  it('gives timeseries a granularity flag and sync a wait flag', () => {
    const program = buildProgram();

    expect(optionNames(subcommand(program, 'timeseries'))).toContain('--granularity');
    expect(optionNames(subcommand(program, 'sync'))).toContain('--wait');
  });

  it('defaults timeseries to daily buckets and posts to published order', () => {
    const program = buildProgram();

    expect(subcommand(program, 'timeseries').opts().granularity).toBe('DAILY');
    expect(subcommand(program, 'posts').opts().sortBy).toBe('PUBLISHED_AT');
  });
});

describe('resolveDateRange', () => {
  const now = new Date('2026-09-18T09:00:00.000Z');

  it('defaults to the last 30 days', () => {
    expect(resolveDateRange(undefined, undefined, now)).toEqual({
      from: '2026-08-19T09:00:00.000Z',
      to: '2026-09-18T09:00:00.000Z',
    });
  });

  it('normalises plain dates to UTC midnight', () => {
    expect(resolveDateRange('2026-08-01', '2026-09-01', now)).toEqual({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    });
  });

  it('counts 30 days back from --to when only --to is given', () => {
    expect(resolveDateRange(undefined, '2026-03-31T00:00:00.000Z', now).from).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('rejects a date it cannot parse', () => {
    expect(() => resolveDateRange('not-a-date', undefined, now)).toThrow(/--from/);
  });

  it('rejects a window that ends before it starts', () => {
    expect(() => resolveDateRange('2026-09-01', '2026-08-01', now)).toThrow(
      /must not be earlier/,
    );
  });
});

describe('enum normalisation', () => {
  it('uppercases a known granularity', () => {
    expect(normalizeGranularity('weekly')).toBe('WEEKLY');
  });

  it('rejects an unknown granularity', () => {
    expect(() => normalizeGranularity('hourly')).toThrow(/Unknown granularity/);
  });

  it('accepts a sort metric in kebab or snake case', () => {
    expect(normalizeSortMetric('engagement-rate')).toBe('ENGAGEMENT_RATE');
    expect(normalizeSortMetric('published_at')).toBe('PUBLISHED_AT');
  });

  it('rejects an unknown sort metric', () => {
    expect(() => normalizeSortMetric('virality')).toThrow(/Unknown sort metric/);
  });
});

describe('assertBreakdownHasNoPlatformFilter', () => {
  it('passes when no platform filter was given', () => {
    expect(() => assertBreakdownHasNoPlatformFilter([])).not.toThrow();
    expect(() => assertBreakdownHasNoPlatformFilter()).not.toThrow();
  });

  it('refuses a filter the API would strip', () => {
    expect(() => assertBreakdownHasNoPlatformFilter(['TWITTER'])).toThrow(
      'platform-breakdown does not support --platform; the API ignores it.',
    );
  });
});

describe('summarizeSeries', () => {
  it('sums a per-bucket count', () => {
    expect(summarizeSeries([300, 450, 450], { rate: false, summary: 'sum' })).toBe('1,200');
  });

  it('takes the latest value for a point-in-time level instead of summing it', () => {
    expect(summarizeSeries([5380, 5390, 5400], { rate: false, summary: 'latest' })).toBe('5,400');
  });

  it('skips trailing gaps when taking the latest value', () => {
    expect(summarizeSeries([5380, 5400, null], { rate: false, summary: 'latest' })).toBe('5,400');
  });

  it('formats a rate from the latest bucket', () => {
    expect(summarizeSeries([8, 9, 9.4], { rate: true, summary: 'latest' })).toBe('9.4%');
  });

  it('reports an em dash when every bucket is empty', () => {
    expect(summarizeSeries([null, null], { rate: false, summary: 'latest' })).toBe('—');
  });
});

describe('sparkline', () => {
  it('returns nothing for an all-null series', () => {
    expect(sparkline([null, null])).toBe('');
  });

  it('maps the low and high points to the outer blocks', () => {
    expect(sparkline([0, 50, 100])).toBe('▁▅█');
  });

  it('draws a flat series at a constant height', () => {
    expect(sparkline([7, 7, 7])).toBe('▄▄▄');
  });

  it('leaves a gap where a bucket has no data', () => {
    expect(sparkline([1, null, 9])).toBe('▁ █');
  });
});

describe('metric formatting', () => {
  it('groups counts and dashes out missing values', () => {
    expect(formatCount(182940)).toBe('182,940');
    expect(formatCount(null)).toBe('—');
    expect(formatRate(6.24)).toBe('6.2%');
    expect(formatRate(null)).toBe('—');
  });

  it('prints a percentage change for count metrics', () => {
    expect(formatChange({ value: 120, previousValue: 100, deltaPercent: 21 }, false)).toBe(
      '+21.0%',
    );
    expect(formatChange({ value: 80, previousValue: 100, deltaPercent: -20 }, false)).toBe(
      '-20.0%',
    );
  });

  it('prints percentage points for rate metrics', () => {
    expect(formatChange({ value: 6.2, previousValue: 6, deltaPercent: 3.3 }, true)).toBe('+0.2pp');
  });

  it('prints a dash when there is nothing to compare against', () => {
    expect(formatChange({ value: 10, previousValue: null, deltaPercent: null }, false)).toBe('—');
    expect(formatChange({ value: 10, previousValue: null, deltaPercent: 5 }, true)).toBe('—');
  });
});
