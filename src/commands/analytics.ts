import type { Command } from 'commander';

import {
  getAnalyticsOverview,
  getAnalyticsSyncStatus,
  getAnalyticsTimeseries,
  getPlatformBreakdown,
  listPostAnalytics,
  triggerAnalyticsSync,
} from '../api/client.js';
import {
  ANALYTICS_GRANULARITIES,
  ANALYTICS_SORT_METRICS,
  type AnalyticsGranularity,
  type AnalyticsMetricValue,
  type AnalyticsSortMetric,
  type AnalyticsSyncStatus,
  type AnalyticsTimeseriesPoint,
  type PlatformBreakdown,
  type PlatformType,
  type PostAnalytics,
} from '../api/types.js';
import {
  dim,
  formatDate,
  formatDuration,
  formatId,
  formatRelative,
  hint,
  isMachine,
  isQuiet,
  networkError,
  parseWhen,
  print,
  printKeyValues,
  printResult,
  printTable,
  spinner,
  usageError,
  validateLimit,
  warn,
  yellow,
  type Column,
} from '../core/index.js';
import { collectPlatform } from './account.js';

const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 86_400_000;
const DEFAULT_POSTS_LIMIT = 20;
const MAX_POSTS_LIMIT = 100;
const MAX_POST_PAGES = 50;
const SYNC_POLL_INTERVAL_MS = 15_000;
const SYNC_POLL_TIMEOUT_MS = 15 * 60_000;

const SPARKLINE_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const FLAT_BLOCK = SPARKLINE_BLOCKS[3];

export type DateRange = {
  from: string;
  to: string;
};

export interface RangeOptions {
  from?: string;
  to?: string;
  platform?: PlatformType[];
}

export interface TimeseriesOptions extends RangeOptions {
  granularity: AnalyticsGranularity;
}

export interface PostsOptions extends RangeOptions {
  sortBy: AnalyticsSortMetric;
  page: string | number;
  limit: string | number;
  all?: boolean;
}

export interface SyncOptions {
  wait?: boolean;
}

const numbers = new Intl.NumberFormat('en-US');

export const normalizeGranularity = (value: string): AnalyticsGranularity => {
  const granularity = value.trim().toUpperCase();
  if (!(ANALYTICS_GRANULARITIES as readonly string[]).includes(granularity)) {
    throw usageError(
      `Unknown granularity "${value}"`,
      `valid values: ${ANALYTICS_GRANULARITIES.join(', ')}`,
    );
  }
  return granularity as AnalyticsGranularity;
};

export const normalizeSortMetric = (value: string): AnalyticsSortMetric => {
  const metric = value.trim().toUpperCase().replace(/-/g, '_');
  if (!(ANALYTICS_SORT_METRICS as readonly string[]).includes(metric)) {
    throw usageError(
      `Unknown sort metric "${value}"`,
      `valid metrics: ${ANALYTICS_SORT_METRICS.join(', ')}`,
    );
  }
  return metric as AnalyticsSortMetric;
};

const parseRangeDate = (value: string, flag: string): Date => {
  try {
    return parseWhen(value);
  } catch {
    throw usageError(
      `${flag} "${value}" is not a date`,
      'use an ISO 8601 date such as 2026-08-19, or an offset such as -7d',
    );
  }
};

export const resolveDateRange = (
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): DateRange => {
  const end = to === undefined ? now : parseRangeDate(to, '--to');
  const start =
    from === undefined
      ? new Date(end.getTime() - DEFAULT_RANGE_DAYS * DAY_MS)
      : parseRangeDate(from, '--from');

  if (start.getTime() > end.getTime()) {
    throw usageError('--to must not be earlier than --from');
  }

  return { from: start.toISOString(), to: end.toISOString() };
};

export const assertBreakdownHasNoPlatformFilter = (platforms: readonly string[] = []): void => {
  if (platforms.length > 0) {
    throw usageError('platform-breakdown does not support --platform; the API ignores it.');
  }
};

export const sparkline = (values: readonly (number | null)[]): string => {
  const present = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (present.length === 0) return '';

  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min;

  return values
    .map((value) => {
      if (value === null || !Number.isFinite(value)) return ' ';
      if (span === 0) return FLAT_BLOCK;
      const index = Math.round(((value - min) / span) * (SPARKLINE_BLOCKS.length - 1));
      return SPARKLINE_BLOCKS[index];
    })
    .join('');
};

export const formatCount = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : numbers.format(Number(value.toFixed(digits)));

export const formatRate = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;

export const formatChange = (metric: AnalyticsMetricValue, isRate: boolean): string => {
  if (isRate) {
    if (metric.value === null || metric.previousValue === null) return '—';
    const points = metric.value - metric.previousValue;
    return `${points >= 0 ? '+' : ''}${points.toFixed(1)}pp`;
  }
  if (metric.deltaPercent === null) return '—';
  return `${metric.deltaPercent >= 0 ? '+' : ''}${metric.deltaPercent.toFixed(1)}%`;
};

const relative = (iso: string | null): string => {
  if (iso === null) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : formatRelative(date);
};

const day = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatDate(date);
};

const rangeHeader = (range: DateRange, platforms: readonly PlatformType[] = []): string =>
  `${day(range.from)} → ${day(range.to)} · ${
    platforms.length > 0 ? platforms.join(', ') : 'all platforms'
  }`;

const platformsOf = (options: RangeOptions): PlatformType[] | undefined =>
  options.platform && options.platform.length > 0 ? options.platform : undefined;

const withProgress = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
  const progress = isQuiet() || isMachine() ? null : spinner(label);
  try {
    return await operation();
  } finally {
    progress?.stop();
  }
};

interface OverviewRow {
  label: string;
  metric: AnalyticsMetricValue;
  rate: boolean;
}

const OVERVIEW_COLUMNS: Column<OverviewRow>[] = [
  { header: 'METRIC', value: (row) => row.label },
  {
    header: 'VALUE',
    align: 'right',
    value: (row) => (row.rate ? formatRate(row.metric.value) : formatCount(row.metric.value)),
  },
  {
    header: 'PREVIOUS',
    align: 'right',
    value: (row) =>
      row.rate ? formatRate(row.metric.previousValue) : formatCount(row.metric.previousValue),
  },
  { header: 'CHANGE', align: 'right', value: (row) => formatChange(row.metric, row.rate) },
];

const runOverview = async (options: RangeOptions): Promise<void> => {
  const range = resolveDateRange(options.from, options.to);
  const overview = await withProgress('Loading overview…', () =>
    getAnalyticsOverview({ ...range, platforms: platformsOf(options) }),
  );

  if (isMachine()) {
    printResult('analytics.overview', overview, range);
    return;
  }

  print(rangeHeader(range, options.platform));
  print();

  printTable<OverviewRow>(
    [
      { label: 'Views', metric: overview.views, rate: false },
      { label: 'Likes', metric: overview.likes, rate: false },
      { label: 'Comments', metric: overview.comments, rate: false },
      { label: 'Shares', metric: overview.shares, rate: false },
      { label: 'Followers', metric: overview.followers, rate: false },
      { label: 'Posts', metric: overview.postsCount, rate: false },
      { label: 'Avg views / post', metric: overview.avgViewsPerPost, rate: false },
      { label: 'Engagement rate', metric: overview.engagementRate, rate: true },
    ],
    OVERVIEW_COLUMNS,
  );

  print();

  if (overview.partialMetrics.length > 0) {
    print(yellow(`! partial metrics: ${overview.partialMetrics.join(', ')}`));
  }

  print(dim(`last synced ${relative(overview.lastSyncedAt)}`));
};

interface TimeseriesMetric {
  key: Exclude<keyof AnalyticsTimeseriesPoint, 'date'>;
  header: string;
  label: string;
  rate: boolean;
  summary: 'sum' | 'latest';
}

const TIMESERIES_METRICS: TimeseriesMetric[] = [
  { key: 'views', header: 'VIEWS', label: 'views', rate: false, summary: 'sum' },
  { key: 'likes', header: 'LIKES', label: 'likes', rate: false, summary: 'sum' },
  { key: 'comments', header: 'COMMENTS', label: 'comments', rate: false, summary: 'sum' },
  { key: 'shares', header: 'SHARES', label: 'shares', rate: false, summary: 'sum' },
  { key: 'followers', header: 'FOLLOWERS', label: 'followers', rate: false, summary: 'latest' },
  { key: 'postsCount', header: 'POSTS', label: 'posts', rate: false, summary: 'sum' },
  { key: 'engagementRate', header: 'ENG', label: 'engagement', rate: true, summary: 'latest' },
];

export const summarizeSeries = (
  series: readonly (number | null)[],
  metric: Pick<TimeseriesMetric, 'rate' | 'summary'>,
): string => {
  if (metric.summary === 'latest') {
    const latest = [...series].reverse().find((value) => value !== null) ?? null;
    return metric.rate ? formatRate(latest) : formatCount(latest);
  }
  return formatCount(series.reduce<number>((sum, value) => sum + (value ?? 0), 0));
};

const TIMESERIES_COLUMNS: Column<AnalyticsTimeseriesPoint>[] = [
  { header: 'DATE', value: (point) => day(point.date) },
  ...TIMESERIES_METRICS.map<Column<AnalyticsTimeseriesPoint>>((metric) => ({
    header: metric.header,
    align: 'right',
    value: (point) =>
      metric.rate ? formatRate(point[metric.key]) : formatCount(point[metric.key]),
  })),
];

const runTimeseries = async (options: TimeseriesOptions): Promise<void> => {
  const range = resolveDateRange(options.from, options.to);
  const { points } = await withProgress('Loading timeseries…', () =>
    getAnalyticsTimeseries({
      ...range,
      granularity: options.granularity,
      platforms: platformsOf(options),
    }),
  );

  if (isMachine()) {
    printResult('analytics.timeseries', points, {
      ...range,
      granularity: options.granularity,
      total: points.length,
      hasMore: false,
    });
    return;
  }

  print(`${rangeHeader(range, options.platform)} · ${options.granularity.toLowerCase()}`);
  print();

  if (points.length === 0) {
    print('No data in this window.');
    return;
  }

  printTable(points, TIMESERIES_COLUMNS);
  print();

  const width = Math.max(...TIMESERIES_METRICS.map((metric) => metric.label.length));

  for (const metric of TIMESERIES_METRICS) {
    const series = points.map((point) => point[metric.key]);
    const line = sparkline(series);
    if (line === '') continue;

    print(`${metric.label.padEnd(width)}  ${line}  ${summarizeSeries(series, metric)}`);
  }
};

const BREAKDOWN_COLUMNS: Column<PlatformBreakdown>[] = [
  { header: 'PLATFORM', value: (row) => row.platform },
  { header: 'FOLLOWERS', align: 'right', value: (row) => formatCount(row.followers.value) },
  { header: 'VIEWS', align: 'right', value: (row) => formatCount(row.views.value) },
  { header: 'LIKES', align: 'right', value: (row) => formatCount(row.likes.value) },
  { header: 'COMMENTS', align: 'right', value: (row) => formatCount(row.comments.value) },
  { header: 'SHARES', align: 'right', value: (row) => formatCount(row.shares.value) },
  { header: 'POSTS', align: 'right', value: (row) => formatCount(row.postsCount.value) },
  { header: 'AVG VIEWS', align: 'right', value: (row) => formatCount(row.avgViewsPerPost.value) },
  { header: 'ENG', align: 'right', value: (row) => formatRate(row.engagementRate.value) },
];

const runBreakdown = async (options: RangeOptions): Promise<void> => {
  assertBreakdownHasNoPlatformFilter(options.platform);

  const range = resolveDateRange(options.from, options.to);
  const { platforms } = await withProgress('Loading platform breakdown…', () =>
    getPlatformBreakdown(range),
  );

  if (isMachine()) {
    printResult('analytics.breakdown', platforms, {
      ...range,
      total: platforms.length,
      hasMore: false,
    });
    return;
  }

  print(rangeHeader(range));
  print();

  if (platforms.length === 0) {
    print('No platform data in this window.');
    return;
  }

  printTable(platforms, BREAKDOWN_COLUMNS);
  print();
  print(`${platforms.length} ${platforms.length === 1 ? 'platform' : 'platforms'}`);

  for (const item of platforms) {
    if (item.supportedMetrics.length === 0) {
      print(dim(`${item.platform} reports no analytics`));
      continue;
    }
    print(dim(`${item.platform} reports ${item.supportedMetrics.join(', ')}`));
  }
};

const POSTS_COLUMNS: Column<PostAnalytics>[] = [
  { header: 'ID', value: (post) => formatId(post.id) },
  { header: 'PLATFORM', value: (post) => post.platform },
  { header: 'PUBLISHED', value: (post) => day(post.publishedAt) },
  { header: 'VIEWS', align: 'right', value: (post) => formatCount(post.metrics.views) },
  { header: 'LIKES', align: 'right', value: (post) => formatCount(post.metrics.likes) },
  { header: 'COMMENTS', align: 'right', value: (post) => formatCount(post.metrics.comments) },
  { header: 'SHARES', align: 'right', value: (post) => formatCount(post.metrics.shares) },
  { header: 'ENG', align: 'right', value: (post) => formatRate(post.metrics.engagementRate) },
  { header: 'TITLE', value: (post) => post.title ?? post.accountName ?? '—' },
];

const runPosts = async (options: PostsOptions): Promise<void> => {
  const range = resolveDateRange(options.from, options.to);
  const limit = options.all
    ? MAX_POSTS_LIMIT
    : validateLimit(Number(options.limit ?? DEFAULT_POSTS_LIMIT), 1, MAX_POSTS_LIMIT);
  const firstPage = options.all ? 1 : validateLimit(Number(options.page ?? 1), 1, 100_000, '--page');
  const platforms = platformsOf(options);

  const collected: PostAnalytics[] = [];
  let page = firstPage;
  let total = 0;
  let hasMore = false;
  let requests = 0;

  do {
    const response = await withProgress(
      requests === 0 ? 'Loading post analytics…' : `Loading post analytics (page ${page})…`,
      () =>
        listPostAnalytics({
          ...range,
          platforms,
          sortBy: options.sortBy,
          page,
          limit,
        }),
    );

    collected.push(...response.posts);
    total = response.total;
    hasMore = response.hasMore;
    requests += 1;
    page += 1;
  } while (options.all && hasMore && requests < MAX_POST_PAGES);

  if (options.all && hasMore) {
    warn(`stopped after ${MAX_POST_PAGES} requests (${collected.length} posts). Narrow --from`);
  }

  if (isMachine()) {
    printResult('analytics.posts', collected, {
      ...range,
      sortBy: options.sortBy,
      total,
      limit,
      page: options.all ? firstPage : page - 1,
      hasMore: options.all ? false : hasMore,
    });
    return;
  }

  print(`${rangeHeader(range, options.platform)} · sorted by ${options.sortBy}`);
  print();

  if (collected.length === 0) {
    print('No posts with analytics in this window.');
    return;
  }

  printTable(collected, POSTS_COLUMNS);
  print();
  print(`${collected.length} of ${total}`);

  if (!options.all && hasMore) {
    hint(`next: adaptlypost analytics posts --page ${page} --limit ${limit}`);
  }
};

const SYNC_COLUMNS: Column<AnalyticsSyncStatus['platforms'][number]>[] = [
  { header: 'PLATFORM', value: (row) => row.platform },
  { header: 'ACCOUNT', value: (row) => row.accountName ?? '—' },
  { header: 'STATUS', value: (row) => (row.status === 'FAILED' ? yellow(row.status) : row.status) },
  { header: 'LAST SYNC', value: (row) => relative(row.lastSyncedAt) },
  { header: 'DISCOVERY', value: (row) => relative(row.lastDiscoveryAt) },
  {
    header: 'NOTE',
    value: (row) =>
      row.needsAnalyticsReconnect
        ? 'reconnect to grant analytics scopes'
        : (row.lastErrorMessage ?? '—'),
  },
];

const renderSyncStatus = (status: AnalyticsSyncStatus): void => {
  printKeyValues(
    [
      ['workspace', status.accountGroupId],
      ['syncing', status.syncInProgress ? 'yes' : 'no'],
      ['last sync', relative(status.lastSyncedAt)],
      [
        'history',
        status.historyHorizonAt === null ? '—' : `back to ${day(status.historyHorizonAt)}`,
      ],
    ],
    '',
  );

  if (status.platforms.length === 0) {
    print();
    print('No connected accounts to sync.');
    return;
  }

  print();
  printTable(status.platforms, SYNC_COLUMNS);

  const reconnect = status.platforms.filter((platform) => platform.needsAnalyticsReconnect);
  if (reconnect.length > 0) {
    print();
    print(yellow(`! ${reconnect.length} account(s) need reconnecting before analytics can sync`));
    hint('reconnect: adaptlypost open accounts');
  }
};

const runSyncStatus = async (): Promise<void> => {
  const status = await withProgress('Loading sync status…', getAnalyticsSyncStatus);

  if (isMachine()) {
    printResult('analytics.sync-status', status);
    return;
  }

  renderSyncStatus(status);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForSync = async (): Promise<AnalyticsSyncStatus> => {
  const startedAt = Date.now();
  const progress = isQuiet() || isMachine() ? null : spinner('Syncing…');

  try {
    for (;;) {
      const status = await getAnalyticsSyncStatus();
      if (!status.syncInProgress) return status;

      if (Date.now() - startedAt >= SYNC_POLL_TIMEOUT_MS) {
        throw networkError(
          'Timed out after 15m waiting for the sync to finish',
          undefined,
          'check it later: adaptlypost analytics sync-status',
        );
      }

      progress?.update(`Syncing… ${formatDuration(Date.now() - startedAt)}`);
      await sleep(SYNC_POLL_INTERVAL_MS);
    }
  } finally {
    progress?.stop();
  }
};

const runSync = async (options: SyncOptions): Promise<void> => {
  const result = await withProgress('Queueing sync…', triggerAnalyticsSync);

  if (!result.queued) {
    if (isMachine()) {
      printResult('analytics.sync', result);
      return;
    }

    const cooldown = result.cooldownSecondsRemaining;
    print(
      yellow(
        cooldown !== null && cooldown > 0
          ? `! Not queued. A sync ran recently; try again in ${formatDuration(cooldown * 1000)}.`
          : `! Not queued. ${result.message}`,
      ),
    );
    return;
  }

  if (!options.wait) {
    if (isMachine()) {
      printResult('analytics.sync', result);
      return;
    }

    print(`✓ Sync queued. ${result.message}`);
    hint('follow it: adaptlypost analytics sync-status');
    return;
  }

  const status = await waitForSync();

  if (isMachine()) {
    printResult('analytics.sync', { ...result, status });
    return;
  }

  print(`✓ Sync finished · last synced ${relative(status.lastSyncedAt)}`);
  print();
  renderSyncStatus(status);
};

const withRange = (command: Command): Command =>
  command
    .option('--from <date>', 'start of the window, ISO 8601 or an offset like -7d (default: 30 days ago)')
    .option('--to <date>', 'end of the window, ISO 8601 (default: now)');

const withPlatforms = (command: Command): Command =>
  command.option(
    '--platform <platform>',
    'limit to a platform, repeatable',
    collectPlatform,
    [] as PlatformType[],
  );

export const registerAnalyticsCommands = (program: Command): void => {
  const analytics = program.command('analytics').description('social analytics for the workspace');

  withPlatforms(
    withRange(
      analytics.command('overview').description('aggregate metrics with period-on-period change'),
    ),
  ).action(async (options: RangeOptions) => {
    await runOverview(options);
  });

  withPlatforms(
    withRange(
      analytics.command('timeseries').description('metrics over time, with a sparkline per metric'),
    ),
  )
    .option(
      '--granularity <granularity>',
      `bucket size: ${ANALYTICS_GRANULARITIES.join(', ')}`,
      normalizeGranularity,
      'DAILY' as AnalyticsGranularity,
    )
    .action(async (options: TimeseriesOptions) => {
      await runTimeseries(options);
    });

  withPlatforms(
    withRange(
      analytics
        .command('breakdown')
        .alias('platforms')
        .description('per-platform breakdown; the API ignores platform filters here'),
    ),
  ).action(async (options: RangeOptions) => {
    await runBreakdown(options);
  });

  withPlatforms(withRange(analytics.command('posts').description('per-post analytics')))
    .option(
      '--sort-by <metric>',
      `sort metric: ${ANALYTICS_SORT_METRICS.join(', ')}`,
      normalizeSortMetric,
      'PUBLISHED_AT' as AnalyticsSortMetric,
    )
    .option('--page <n>', '1-based page number', String(1))
    .option('--limit <n>', 'rows per page, 1..100', String(DEFAULT_POSTS_LIMIT))
    .option('--all', `page through every result, up to ${MAX_POST_PAGES} requests`)
    .action(async (options: PostsOptions) => {
      await runPosts(options);
    });

  analytics
    .command('sync-status')
    .alias('status')
    .description('per-account sync state and history horizon')
    .action(async () => {
      await runSyncStatus();
    });

  analytics
    .command('sync')
    .description('queue an analytics sync for the workspace')
    .option('--wait', 'poll sync-status every 15s until the sync finishes')
    .action(async (options: SyncOptions) => {
      await runSync(options);
    });
};
