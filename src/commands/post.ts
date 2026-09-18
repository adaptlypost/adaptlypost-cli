import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { Command } from "commander";

import {
  bulkSchedulePosts,
  createPost,
  deletePost,
  getPost,
  listPostResults,
  listPosts,
  listSocialAccounts,
  publishDraft,
  retryFailedPlatforms,
  updatePost,
} from "../api/client.js";
import {
  META_POST_TYPES,
  POST_STATUSES,
  TIKTOK_PRIVACY_LEVELS,
  type BulkPostInput,
  type BulkSchedulePostsRequest,
  type ContentType,
  type PlatformText,
  type PlatformType,
  type PostResult,
  type PostResultsResponse,
  type PostStatus,
  type PostTargets,
  type SocialAccount,
  type SocialPost,
  type UpdatePostRequest,
} from "../api/types.js";
import {
  CliError,
  ExitCode,
  assertTimeZone,
  failure,
  formatAbsolute,
  formatDuration,
  formatId,
  formatRelative,
  hint,
  isMachine,
  isQuiet,
  paginateAll,
  parseDuration,
  parseWhen,
  poll,
  print,
  printFieldHints,
  printKeyValues,
  printResult,
  printTable,
  profileDefaults,
  promptConfirm,
  readCsv,
  spinner,
  success,
  toIso,
  validateLimit,
  validateOffset,
  type Cursor,
} from "../core/index.js";
import {
  buildPostBody,
  buildTargets,
  mergePostInput,
  normalizeContentType,
  normalizePlatformName,
  parsePostInput,
  readSource,
  readStdin,
  uploadLocalMedia,
  type PostInput,
} from "./post-input.js";

const TERMINAL_PLATFORM_STATUSES = new Set(["PUBLISHED", "FAILED"]);
const TERMINAL_POST_STATUSES = new Set<PostStatus>(["COMPLETED", "PARTIAL_FAILURE", "FAILED"]);
const BULK_CHUNK = 100;
const WATCH_LEAD_MS = 10_000;

const collect = (value: string, previous: string[]): string[] => [...previous, value];

const collectPlatform = (value: string, previous: PlatformType[]): PlatformType[] => [
  ...previous,
  normalizePlatformName(value),
];

const parsePair = (value: string, flag: string): [string, string] => {
  const index = value.indexOf("=");
  if (index <= 0) {
    throw new CliError(`${flag} expects PLATFORM=value, got "${value}".`, {
      exitCode: ExitCode.USAGE,
    });
  }
  return [value.slice(0, index), value.slice(index + 1)];
};

const oneLine = (text: string | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim() || "—";

const platformsOf = (post: SocialPost): PlatformType[] => [
  ...new Set((post.platforms ?? []).map((target) => target.platform)),
];

interface GlobalOptions {
  yes?: boolean;
  quiet?: boolean;
  timezone?: string;
}

const resolveTimezone = (explicit?: string): string => {
  const timezone = explicit ?? profileDefaults().timezone ?? "UTC";
  return assertTimeZone(timezone);
};

const whenCell = (post: SocialPost, timezone: string): string => {
  if (!post.scheduledAt) return "—";
  const date = new Date(post.scheduledAt);
  return `${formatRelative(date)}  ${formatAbsolute(date, { timezone, withZone: false })}`;
};

const clock = (date: Date, timezone: string): string =>
  formatAbsolute(date, { timezone, seconds: true, withZone: false }).slice(11);

async function loadAccounts(quiet: boolean): Promise<SocialAccount[]> {
  const progress = quiet || isMachine() ? null : spinner("Loading accounts…");
  try {
    return (await listSocialAccounts()).accounts;
  } finally {
    progress?.stop();
  }
}

interface ContentOptions {
  text?: string;
  file?: string;
  platform: PlatformType[];
  type?: string;
  media: string[];
  thumbnail?: string;
  thumbnailMs?: string;
  at?: string;
  timezone?: string;
  draft?: boolean;
  account: string[];
  page: string[];
  textFor: string[];
  config: string[];
  tiktokPrivacy?: string;
  igType?: string;
  ytTitle?: string;
  pinterestBoard?: string;
}

async function inputFromOptions(options: ContentOptions): Promise<PostInput> {
  const input: PostInput = {};

  if (options.text !== undefined) {
    input.text = options.text === "-" ? (await readStdin()).trim() : options.text;
  }

  if (options.platform.length > 0) input.platforms = options.platform;

  const accounts = [...options.account, ...options.page];
  if (accounts.length > 0) input.accounts = accounts;

  if (options.type !== undefined) input.contentType = normalizeContentType(options.type);
  if (options.media.length > 0) input.media = options.media;
  if (options.thumbnail !== undefined) input.thumbnail = options.thumbnail;
  if (options.at !== undefined) input.at = options.at;
  if (options.timezone !== undefined) input.timezone = options.timezone;
  if (options.draft) input.draft = true;

  if (options.thumbnailMs !== undefined) {
    const ms = Number(options.thumbnailMs);
    if (!Number.isInteger(ms) || ms < 0) {
      throw new CliError("--thumbnail-ms must be a whole number of milliseconds.", {
        exitCode: ExitCode.USAGE,
      });
    }
    input.thumbnailMs = ms;
  }

  for (const entry of options.textFor) {
    const [platform, text] = parsePair(entry, "--text-for");
    input.platformTexts = {
      ...input.platformTexts,
      [normalizePlatformName(platform)]: text,
    };
  }

  const configs: PostInput["platformConfigs"] = { ...input.platformConfigs };

  const mergeConfig = (platform: PlatformType, values: Record<string, unknown>): void => {
    configs[platform] = { ...configs[platform], ...values } as Record<string, never>;
  };

  for (const entry of options.config) {
    const [platform, json] = parsePair(entry, "--config");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new CliError(`--config ${platform} is not valid JSON: ${(error as Error).message}`, {
        exitCode: ExitCode.USAGE,
        cause: error,
      });
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new CliError(`--config ${platform} must be a JSON object.`, {
        exitCode: ExitCode.USAGE,
      });
    }
    mergeConfig(normalizePlatformName(platform), parsed as Record<string, unknown>);
  }

  if (options.tiktokPrivacy !== undefined) {
    const level = options.tiktokPrivacy.trim().toUpperCase();
    if (!(TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(level)) {
      throw new CliError(
        `Unknown TikTok privacy level "${options.tiktokPrivacy}". Expected one of: ${TIKTOK_PRIVACY_LEVELS.join(", ")}.`,
        { exitCode: ExitCode.USAGE },
      );
    }
    mergeConfig("TIKTOK", { privacyLevel: level });
  }

  if (options.igType !== undefined) {
    const postType = options.igType.trim().toUpperCase();
    if (!(META_POST_TYPES as readonly string[]).includes(postType)) {
      throw new CliError(
        `Unknown Instagram post type "${options.igType}". Expected one of: ${META_POST_TYPES.join(", ")}.`,
        { exitCode: ExitCode.USAGE },
      );
    }
    mergeConfig("INSTAGRAM", { postType });
  }

  if (options.ytTitle !== undefined) mergeConfig("YOUTUBE", { videoTitle: options.ytTitle });
  if (options.pinterestBoard !== undefined) {
    mergeConfig("PINTEREST", { boardId: options.pinterestBoard });
  }

  if (Object.keys(configs).length > 0) input.platformConfigs = configs;

  return input;
}

async function resolveInput(
  options: ContentOptions,
  applyDefaultPlatforms = true,
): Promise<PostInput> {
  const fromFile = options.file === undefined ? {} : parsePostInput(await readSource(options.file));
  const fromFlags = await inputFromOptions(options);
  const merged = mergePostInput(fromFile, fromFlags);

  if (applyDefaultPlatforms && (merged.platforms === undefined || merged.platforms.length === 0)) {
    const fallback = profileDefaults().defaultPlatforms;
    if (fallback && fallback.length > 0) {
      merged.platforms = fallback.map(normalizePlatformName);
    }
  }

  merged.timezone = resolveTimezone(merged.timezone);

  if (merged.at !== undefined) {
    merged.at = toIso(parseWhen(merged.at, { timezone: merged.timezone }));
  }

  return merged;
}

async function resolveMedia(input: PostInput, quiet: boolean): Promise<string[]> {
  const references = input.media ?? [];
  if (references.length === 0) return [];

  const progress = quiet || isMachine() ? null : spinner(`Uploading ${references.length} file(s)…`);
  try {
    const urls = await uploadLocalMedia(references);
    return references.map((reference) => {
      const url = urls.get(reference);
      if (!url) {
        throw new CliError(`No upload URL came back for ${reference}.`, {
          exitCode: ExitCode.GENERIC,
        });
      }
      return url;
    });
  } finally {
    progress?.stop();
  }
}

interface ListOptions extends GlobalOptions {
  limit?: string;
  offset?: string;
  all?: boolean;
  status: string[];
  platform: PlatformType[];
  from?: string;
  to?: string;
  sort: string;
}

async function runList(options: ListOptions): Promise<void> {
  const statuses = options.status.map((value) => {
    const status = value.trim().toUpperCase() as PostStatus;
    if (!(POST_STATUSES as readonly string[]).includes(status)) {
      throw new CliError(
        `Unknown status "${value}". Expected one of: ${POST_STATUSES.join(", ")}.`,
        { exitCode: ExitCode.USAGE },
      );
    }
    return status;
  });

  const sortOrder = options.sort.trim().toUpperCase();
  if (sortOrder !== "NEWEST" && sortOrder !== "OLDEST") {
    throw new CliError(`--sort must be NEWEST or OLDEST, got "${options.sort}".`, {
      exitCode: ExitCode.USAGE,
    });
  }

  const timezone = resolveTimezone(options.timezone);
  const limit = options.limit === undefined ? 20 : validateLimit(options.limit, 1, 100);
  const offset = validateOffset(options.offset);

  const query = {
    statuses: statuses.length > 0 ? statuses : undefined,
    platforms: options.platform.length > 0 ? options.platform : undefined,
    startDate: options.from === undefined ? undefined : toIso(parseWhen(options.from, { timezone })),
    endDate: options.to === undefined ? undefined : toIso(parseWhen(options.to, { timezone })),
    sortOrder,
  } as const;

  let posts: SocialPost[];
  let total: number | undefined;
  let hasMore = false;

  if (options.all) {
    const paged = await paginateAll<SocialPost>({
      pageSize: 100,
      offset,
      quiet: Boolean(options.quiet) || isQuiet(),
      fetchPage: async (page) => {
        const response = await listPosts({ ...query, limit: page.limit, offset: page.offset });
        return { items: response.posts, total: response.total, hasMore: response.hasMore };
      },
    });
    posts = paged.items;
    total = paged.total;
  } else {
    const response = await listPosts({ ...query, limit, offset });
    posts = response.posts;
    total = response.total;
    hasMore = response.hasMore;
  }

  if (isMachine()) {
    printResult("post.list", posts, {
      total,
      limit: options.all ? undefined : limit,
      offset: options.all ? undefined : offset,
      hasMore,
    });
    printFieldHints(posts);
    return;
  }

  if (posts.length === 0) {
    print("No posts match those filters.");
    return;
  }

  printTable(posts, [
    { header: "ID", value: (post) => formatId(post.id) },
    { header: "WHEN", value: (post) => whenCell(post, post.timezone || timezone) },
    { header: "STATUS", value: (post) => post.status },
    { header: "PLATFORMS", value: (post) => platformsOf(post).join(", ") || "—" },
    { header: "TEXT", value: (post) => oneLine(post.text) },
  ]);

  print("");
  print(`${posts.length} of ${total ?? posts.length}`);

  if (hasMore) print(`next: --offset ${offset + posts.length}`);
}

async function runView(id: string, options: GlobalOptions): Promise<void> {
  const post = await getPost(id);

  if (isMachine()) {
    printResult("post.view", post);
    return;
  }

  const timezone = post.timezone || resolveTimezone(options.timezone);

  print(post.id);
  printKeyValues([
    ["status", post.status],
    ["type", post.contentType],
    [
      "when",
      post.scheduledAt
        ? `${formatAbsolute(new Date(post.scheduledAt), { timezone })} (${formatRelative(new Date(post.scheduledAt))})`
        : "not scheduled",
    ],
    ["text", oneLine(post.text)],
  ]);

  const targets = post.platforms ?? [];
  if (targets.length === 0) return;

  print("");
  printTable(targets, [
    { header: "PLATFORM", value: (target) => target.platform },
    { header: "ACCOUNT", value: (target) => target.accountName ?? target.connectionId ?? target.pageId ?? "—" },
    { header: "STATUS", value: (target) => target.status },
    { header: "CHARS", value: (target) => (target.text ?? post.text ?? "").length, align: "right" },
    { header: "POST ID", value: (target) => target.platformPostId ?? "—" },
    { header: "ERROR", value: (target) => target.errorMessage ?? "—" },
  ]);
}

interface CreateOptions extends ContentOptions, GlobalOptions {
  watch?: boolean;
  dryRun?: boolean;
  timeout: string;
}

async function runCreate(options: CreateOptions): Promise<void> {
  const quiet = Boolean(options.quiet) || isQuiet();
  const input = await resolveInput(options);
  const accounts = (input.accounts ?? []).length > 0 ? await loadAccounts(quiet) : [];
  const mediaUrls = options.dryRun ? (input.media ?? []) : await resolveMedia(input, quiet);

  const body = buildPostBody(input, { accounts, mediaUrls });

  if (options.dryRun) {
    if (isMachine()) {
      printResult("post.create", body, { dryRun: true });
      return;
    }
    print(JSON.stringify(body, null, 2));
    const local = mediaUrls.filter((url) => !/^https?:\/\//i.test(url));
    hint(
      local.length > 0
        ? `dry run: nothing was sent; ${local.length} local file(s) would be uploaded first`
        : "dry run: nothing was sent",
    );
    return;
  }

  const created = await createPost(body);

  if (isMachine()) {
    printResult("post.create", created);
  } else {
    success(`Post created  ${formatId(created.postId)}`);
    const entries: [string, string][] = [];

    if (created.scheduledAt) {
      const date = new Date(created.scheduledAt);
      entries.push([
        "scheduled",
        `${formatAbsolute(date, { timezone: body.timezone })} (${formatRelative(date)})`,
      ]);
    } else if (body.saveAsDraft) {
      entries.push(["status", "DRAFT"]);
    } else {
      entries.push(["publishing", "now"]);
    }

    if (created.queuedPlatforms.length > 0) {
      entries.push(["queued", created.queuedPlatforms.join(", ")]);
    }

    for (const skipped of created.skippedPlatforms ?? []) {
      entries.push(["skipped", `${skipped.platform}  ${skipped.reason}`]);
    }

    entries.push(["watch", `adaptlypost post watch ${created.postId}`]);
    printKeyValues(entries);
  }

  if (options.watch) {
    await runWatch(created.postId, { timeout: options.timeout, timezone: options.timezone });
  }
}

interface UpdateOptions extends ContentOptions, GlobalOptions {
  dryRun?: boolean;
}

async function runUpdate(id: string, options: UpdateOptions): Promise<void> {
  const quiet = Boolean(options.quiet) || isQuiet();
  const targetsChanged = options.platform.length > 0 || options.account.length > 0 || options.page.length > 0;

  if (options.media.length > 0 && options.platform.length === 0) {
    throw new CliError("--media only takes effect together with --platform.", {
      exitCode: ExitCode.USAGE,
      hint: "Resend the whole target set: --platform TWITTER --account tw_… --media hero.jpg",
    });
  }

  if (options.platform.length > 0) {
    const proceed = await promptConfirm(
      "--platform replaces every target on this post. Accounts and configs you do not resend are dropped. Proceed?",
      { assumeYes: Boolean(options.yes) },
    );
    if (!proceed) {
      throw new CliError("Cancelled.", { exitCode: ExitCode.CANCELLED });
    }
  }

  const input = await resolveInput({ ...options, draft: false }, false);
  const accounts = (input.accounts ?? []).length > 0 ? await loadAccounts(quiet) : [];
  const mediaUrls = options.media.length > 0 ? await resolveMedia(input, quiet) : [];

  const full = buildPostBody(input, {
    accounts,
    mediaUrls,
    requireTargets: false,
    requireContent: false,
  });

  const body: UpdatePostRequest = {};

  if (options.text !== undefined || options.file !== undefined) body.text = full.text;
  if (input.platformTexts !== undefined) body.platformTexts = full.platformTexts;
  if (options.type !== undefined || mediaUrls.length > 0) body.contentType = full.contentType;
  if (options.timezone !== undefined) body.timezone = full.timezone;
  if (input.at !== undefined) body.scheduledAt = full.scheduledAt;
  if (options.thumbnail !== undefined) body.thumbnailUrl = full.thumbnailUrl;
  if (options.thumbnailMs !== undefined) body.thumbnailTimestampMs = full.thumbnailTimestampMs;

  if (targetsChanged) {
    const { platforms, ...rest } = full;
    const carried: PostTargets = {};
    for (const [key, value] of Object.entries(rest)) {
      if (key.endsWith("ConnectionIds") || key.endsWith("Configs") || key === "pageIds") {
        Object.assign(carried, { [key]: value });
      }
    }
    Object.assign(body, carried);
    if (options.platform.length > 0) body.platforms = platforms;
    if (mediaUrls.length > 0) body.mediaUrls = mediaUrls;
  }

  if (Object.keys(body).length === 0) {
    throw new CliError("Nothing to update.", {
      exitCode: ExitCode.USAGE,
      hint: "Pass at least one of --text, --file, --at, --timezone, --type, --thumbnail or --platform",
    });
  }

  if (options.dryRun) {
    if (isMachine()) {
      printResult("post.update", body, { dryRun: true });
      return;
    }
    print(JSON.stringify(body, null, 2));
    hint("dry run: nothing was sent");
    return;
  }

  const post = await updatePost(id, body);

  if (isMachine()) {
    printResult("post.update", post);
    return;
  }

  success(`Post updated  ${formatId(post.id)}`);
  printKeyValues([
    ["status", post.status],
    [
      "when",
      post.scheduledAt
        ? formatAbsolute(new Date(post.scheduledAt), { timezone: post.timezone || "UTC" })
        : "not scheduled",
    ],
    ["platforms", platformsOf(post).join(", ") || "—"],
  ]);
}

async function runDelete(id: string, options: GlobalOptions): Promise<void> {
  if (!options.yes) {
    const post = await getPost(id);
    const platforms = platformsOf(post).join(" + ") || "no platforms";
    const proceed = await promptConfirm(`Delete ${formatId(post.id)} (${post.status}, ${platforms})?`, {
      assumeYes: Boolean(options.yes),
    });
    if (!proceed) {
      throw new CliError("Cancelled.", { exitCode: ExitCode.CANCELLED });
    }
  }

  const deleted = await deletePost(id);

  if (isMachine()) {
    printResult("post.delete", deleted);
    return;
  }

  success("Deleted");
}

interface PublishOptions extends GlobalOptions {
  at?: string;
}

async function runPublish(id: string, options: PublishOptions): Promise<void> {
  const timezone = resolveTimezone(options.timezone);
  const scheduledAt =
    options.at === undefined ? undefined : toIso(parseWhen(options.at, { timezone }));

  const published = await publishDraft(id, { timezone, scheduledAt });

  if (isMachine()) {
    printResult("post.publish", published);
    return;
  }

  if (published.isScheduled && published.scheduledAt) {
    const date = new Date(published.scheduledAt);
    success(`Scheduled  ${formatId(published.postId)}`);
    printKeyValues([
      ["when", `${formatAbsolute(date, { timezone })} (${formatRelative(date)})`],
      ["watch", `adaptlypost post watch ${published.postId}`],
    ]);
    return;
  }

  success(`Publishing  ${formatId(published.postId)}`);
  printKeyValues([
    ["queued", published.queuedPlatforms.join(", ") || "—"],
    ["watch", `adaptlypost post watch ${published.postId}`],
  ]);
}

const resultLink = (result: PostResult): string => {
  if (result.status === "FAILED") return result.errorMessage ?? "failed";
  if (result.tiktokDraftFallback) return "draft fallback";
  return result.platformPostId ?? "—";
};

async function runResults(id: string, options: GlobalOptions): Promise<void> {
  const response = await listPostResults(id);

  if (isMachine()) {
    printResult("post.results", response.results, {
      postId: response.postId,
      status: response.status,
      total: response.results.length,
    });
    printFieldHints(response.results);
    return;
  }

  const timezone = resolveTimezone(options.timezone);

  print(`${formatId(response.postId)} · ${response.status}`);
  print("");

  printTable(response.results, [
    { header: "PLATFORM ID", value: (result) => formatId(result.platformId) },
    { header: "PLATFORM", value: (result) => result.platform },
    { header: "ACCOUNT", value: (result) => result.accountName ?? "—" },
    { header: "STATUS", value: (result) => result.status },
    {
      header: "PUBLISHED",
      value: (result) =>
        result.publishedAt
          ? formatAbsolute(new Date(result.publishedAt), { timezone, withZone: false })
          : "—",
    },
    { header: "LINK / ERROR", value: resultLink },
  ]);

  const failed = response.results.filter((result) => result.status === "FAILED");

  if (failed.length > 0) {
    print("");
    print(`retry: adaptlypost post retry ${response.postId} ${failed.map((result) => `--platform-id ${result.platformId}`).join(" ")}`);
  }
}

interface RetryOptions extends GlobalOptions {
  platformId: string[];
  failed?: boolean;
}

async function runRetry(id: string, options: RetryOptions): Promise<void> {
  let platformIds = options.platformId;

  if (options.failed) {
    const response = await listPostResults(id);
    platformIds = [
      ...new Set([
        ...platformIds,
        ...response.results.filter((result) => result.status === "FAILED").map((result) => result.platformId),
      ]),
    ];
  }

  if (platformIds.length === 0) {
    throw new CliError("No platform to retry.", {
      exitCode: ExitCode.USAGE,
      hint: "Pass --platform-id <id> (repeatable), or --failed to retry every failed platform",
    });
  }

  const retried = await retryFailedPlatforms(id, { platformIds });

  if (isMachine()) {
    printResult("post.retry", retried);
    return;
  }

  success(`Retrying ${platformIds.length} platform(s) on ${formatId(retried.postId)}`);
  printKeyValues([
    ["queued", retried.queuedPlatforms.join(", ") || "—"],
    ["watch", `adaptlypost post watch ${retried.postId}`],
  ]);
}

type WatchEvent =
  | { kind: "result"; result: PostResult; at: Date }
  | { kind: "done"; status: PostStatus };

interface WatchOptions extends GlobalOptions {
  timeout: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

async function waitForSchedule(post: SocialPost, timezone: string): Promise<void> {
  if (!post.scheduledAt) return;

  const target = new Date(post.scheduledAt).getTime() - WATCH_LEAD_MS;
  let remaining = target - Date.now();
  if (remaining <= 0) return;

  hint(
    `Scheduled for ${formatAbsolute(new Date(post.scheduledAt), { timezone })}, waiting ${formatDuration(remaining)}`,
  );

  while (remaining > 0) {
    await sleep(Math.min(remaining, 15_000));
    remaining = target - Date.now();
  }
}

async function runWatch(id: string, options: WatchOptions): Promise<void> {
  const timezone = resolveTimezone(options.timezone);
  const timeoutMs = parseDuration(options.timeout);

  if (timeoutMs === null || timeoutMs <= 0) {
    throw new CliError(`--timeout must be a duration such as 30m, got "${options.timeout}".`, {
      exitCode: ExitCode.USAGE,
    });
  }

  const post = await getPost(id);

  if (!isMachine()) {
    print(
      `Watching ${formatId(post.id)} (${post.platforms?.length ?? 0} platforms). Ctrl-C to stop.`,
    );
  }

  await waitForSchedule(post, timezone);

  const startedAt = Date.now();
  let latest: PostResultsResponse | undefined;
  let finished = false;

  const result = await poll<WatchEvent>({
    intervalMs: 5_000,
    maxIntervalMs: 60_000,
    timeoutMs,
    label: "platform results",
    key: (event) => (event.kind === "done" ? "__done__" : event.result.platformId),
    until: (event) => event.kind === "done",
    fetchPage: async (cursor: Cursor) => {
      const response = await listPostResults(id);
      latest = response;

      const items: WatchEvent[] = response.results
        .filter((entry) => TERMINAL_PLATFORM_STATUSES.has(entry.status))
        .map((entry) => ({ kind: "result" as const, result: entry, at: new Date() }));

      const allTerminal =
        response.results.length > 0 && items.length === response.results.length;

      if (allTerminal || TERMINAL_POST_STATUSES.has(response.status)) {
        finished = true;
        items.push({ kind: "done", status: response.status });
      }

      return { items, cursor };
    },
    onItem: (event) => {
      if (event.kind !== "result") return;
      if (isMachine()) return;
      const line = [
        clock(event.at, timezone),
        event.result.platform.padEnd(10),
        event.result.status.padEnd(10),
        resultLink(event.result),
      ].join("  ");
      print(line);
    },
  });

  const results = latest?.results ?? [];
  const published = results.filter((entry) => entry.status === "PUBLISHED").length;
  const failed = results.filter((entry) => entry.status === "FAILED").length;

  if (isMachine()) {
    printResult("post.watch", results, {
      postId: id,
      status: latest?.status ?? post.status,
      published,
      failed,
      reason: result.reason,
    });
  }

  if (!finished) {
    throw new CliError(
      `Timed out after ${formatDuration(timeoutMs)} with ${results.length - published - failed} platform(s) still pending.`,
      { exitCode: ExitCode.NETWORK, hint: `adaptlypost post results ${id}` },
    );
  }

  if (!isMachine()) {
    const summary = `Finished in ${formatDuration(Date.now() - startedAt)} · ${published} published, ${failed} failed`;
    if (failed > 0) failure(summary);
    else success(summary);
  }

  if (failed > 0) {
    throw new CliError(`${failed} of ${results.length} platform(s) failed.`, {
      exitCode: ExitCode.GENERIC,
      hint: `adaptlypost post retry ${id} --failed`,
    });
  }
}

const CORE_COLUMNS = new Set(["text", "scheduledAt", "contentType", "media", "thumbnail", "thumbnailMs"]);

interface BulkRow {
  line: number;
  item: BulkPostInput;
  mediaRefs: string[];
  configs: PostInput["platformConfigs"];
}

function readBulkColumns(headers: string[]): void {
  const unknown = headers.filter(
    (header) =>
      !CORE_COLUMNS.has(header) &&
      !/^text_[A-Za-z]+$/.test(header) &&
      !/^config_[A-Za-z]+$/.test(header),
  );

  if (unknown.length > 0) {
    throw new CliError(`Unknown CSV column(s): ${unknown.join(", ")}.`, {
      exitCode: ExitCode.VALIDATION,
      hint: `Known columns: ${[...CORE_COLUMNS].join(", ")}, text_<PLATFORM>, config_<PLATFORM>`,
    });
  }
}

function bulkRowFromRecord(
  record: Record<string, string>,
  line: number,
  timezone: string,
): BulkRow {
  const text = (record.text ?? "").trim();
  const mediaRefs = (record.media ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  if (text === "" && mediaRefs.length === 0) {
    throw new CliError(`Row ${line}: text or media is required.`, {
      exitCode: ExitCode.VALIDATION,
    });
  }

  const rawWhen = (record.scheduledAt ?? "").trim();
  if (rawWhen === "") {
    throw new CliError(`Row ${line}: scheduledAt is required.`, {
      exitCode: ExitCode.VALIDATION,
    });
  }

  let scheduledAt: string;
  try {
    scheduledAt = toIso(parseWhen(rawWhen, { timezone }));
  } catch {
    throw new CliError(`Row ${line}: scheduledAt "${rawWhen}" is not a valid date.`, {
      exitCode: ExitCode.VALIDATION,
    });
  }

  const contentTypeRaw = (record.contentType ?? "").trim();
  const contentType: ContentType = contentTypeRaw
    ? normalizeContentType(contentTypeRaw)
    : mediaRefs.length === 0
      ? "TEXT"
      : mediaRefs.length > 1
        ? "CAROUSEL"
        : /\.(mp4|mov|m4v|qt)$/i.test(mediaRefs[0] ?? "")
          ? "VIDEO"
          : "IMAGE";

  const platformTexts: PlatformText[] = [];
  const configs: PostInput["platformConfigs"] = {};

  for (const [column, value] of Object.entries(record)) {
    if (value.trim() === "") continue;

    if (column.startsWith("text_")) {
      platformTexts.push({ platform: normalizePlatformName(column.slice(5)), text: value });
      continue;
    }

    if (column.startsWith("config_")) {
      const platform = normalizePlatformName(column.slice(7));
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        throw new CliError(`Row ${line}: config_${platform} is not valid JSON.`, {
          exitCode: ExitCode.VALIDATION,
          cause: error,
        });
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new CliError(`Row ${line}: config_${platform} must be a JSON object.`, {
          exitCode: ExitCode.VALIDATION,
        });
      }
      configs[platform] = parsed as Record<string, never>;
    }
  }

  const item: BulkPostInput = { contentType, scheduledAt };
  if (text !== "") item.text = text;
  if (platformTexts.length > 0) item.platformTexts = platformTexts;
  if ((record.thumbnail ?? "").trim() !== "") item.thumbnailUrl = record.thumbnail.trim();
  if ((record.thumbnailMs ?? "").trim() !== "") {
    const ms = Number(record.thumbnailMs);
    if (!Number.isInteger(ms) || ms < 0) {
      throw new CliError(`Row ${line}: thumbnailMs must be a whole number.`, {
        exitCode: ExitCode.VALIDATION,
      });
    }
    item.thumbnailTimestampMs = ms;
  }

  return { line, item, mediaRefs, configs: Object.keys(configs).length > 0 ? configs : undefined };
}

async function rowsFromDirectory(path: string, timezone: string): Promise<BulkRow[]> {
  const entries = (await readdir(path)).filter((name) => /\.(md|markdown)$/i.test(name)).sort();

  if (entries.length === 0) {
    throw new CliError(`No markdown files in ${path}.`, { exitCode: ExitCode.USAGE });
  }

  const rows: BulkRow[] = [];

  for (const [index, name] of entries.entries()) {
    const input = parsePostInput(await readSource(join(path, name)));

    if (input.at === undefined) {
      throw new CliError(`${name} has no "at" in its frontmatter.`, {
        exitCode: ExitCode.VALIDATION,
      });
    }

    const item: BulkPostInput = {
      contentType: input.contentType ?? (input.media?.length ? "IMAGE" : "TEXT"),
      scheduledAt: toIso(parseWhen(input.at, { timezone: input.timezone ?? timezone })),
    };

    if (input.text !== undefined) item.text = input.text;
    if (input.thumbnail !== undefined) item.thumbnailUrl = input.thumbnail;
    if (input.thumbnailMs !== undefined) item.thumbnailTimestampMs = input.thumbnailMs;

    const platformTexts = Object.entries(input.platformTexts ?? {}).map(([platform, text]) => ({
      platform: platform as PlatformType,
      text,
    }));
    if (platformTexts.length > 0) item.platformTexts = platformTexts;

    rows.push({
      line: index + 1,
      item,
      mediaRefs: input.media ?? [],
      configs: input.platformConfigs,
    });
  }

  return rows;
}

interface BulkOptions extends GlobalOptions {
  csv?: string;
  jsonFile?: string;
  dir?: string;
  platform: PlatformType[];
  account: string[];
  dryRun?: boolean;
}

async function runBulk(options: BulkOptions): Promise<void> {
  const sources = [options.csv, options.jsonFile, options.dir].filter(Boolean);

  if (sources.length !== 1) {
    throw new CliError("Pass exactly one of --csv, --json-file or --dir.", {
      exitCode: ExitCode.USAGE,
    });
  }

  const quiet = Boolean(options.quiet) || isQuiet();
  const timezone = resolveTimezone(options.timezone);

  if (options.jsonFile !== undefined) {
    await runBulkFromJson(options.jsonFile, options);
    return;
  }

  let rows: BulkRow[];
  let sourceLabel: string;

  if (options.csv !== undefined) {
    const table = readCsv(await readSource(options.csv), { strict: false });
    readBulkColumns(table.headers);
    rows = table.records.map((record) => bulkRowFromRecord(record.record, record.line, timezone));
    sourceLabel = options.csv === "-" ? "stdin" : options.csv;
  } else {
    rows = await rowsFromDirectory(options.dir as string, timezone);
    sourceLabel = options.dir as string;
  }

  if (rows.length === 0) {
    throw new CliError("Nothing to schedule.", { exitCode: ExitCode.VALIDATION });
  }

  if (!isMachine()) print(`Read ${rows.length} rows from ${sourceLabel}`);

  const references = [...new Set(rows.flatMap((row) => row.mediaRefs))];
  const uploaded =
    references.length === 0 || options.dryRun
      ? new Map<string, string>()
      : await (async () => {
          const progress = quiet || isMachine() ? null : spinner(`Uploading ${references.length} file(s)…`);
          try {
            return await uploadLocalMedia(references);
          } finally {
            progress?.stop();
          }
        })();

  for (const row of rows) {
    if (row.mediaRefs.length === 0) continue;
    const urls = row.mediaRefs.map((reference) => uploaded.get(reference) ?? reference);
    row.item.mediaUrls = urls;
  }

  const accounts = options.account.length > 0 ? await loadAccounts(quiet) : [];

  const groups = new Map<string, BulkRow[]>();
  for (const row of rows) {
    const signature = JSON.stringify(row.configs ?? {});
    groups.set(signature, [...(groups.get(signature) ?? []), row]);
  }

  const batches: { request: BulkSchedulePostsRequest; rows: BulkRow[] }[] = [];

  for (const [, groupRows] of groups) {
    const configs = groupRows[0]?.configs;
    const { platforms, targets } = buildTargets(
      {
        platforms: options.platform,
        accounts: options.account,
        platformConfigs: configs,
      },
      accounts,
    );

    if (platforms.length === 0) {
      throw new CliError("No platform to post to.", {
        exitCode: ExitCode.USAGE,
        hint: "Pass --platform TWITTER (repeatable) and --account <id>",
      });
    }

    for (let start = 0; start < groupRows.length; start += BULK_CHUNK) {
      const chunk = groupRows.slice(start, start + BULK_CHUNK);
      batches.push({
        rows: chunk,
        request: {
          platforms,
          timezone,
          posts: chunk.map((row) => row.item),
          ...targets,
        },
      });
    }
  }

  if (options.dryRun) {
    if (isMachine()) {
      printResult("post.bulk", batches.map((batch) => batch.request), { dryRun: true });
      return;
    }
    print(JSON.stringify(batches.map((batch) => batch.request), null, 2));
    hint(`dry run: ${batches.length} request(s), ${rows.length} posts, nothing was sent`);
    return;
  }

  let scheduled = 0;
  const failures: { line: number; message: string }[] = [];
  const outcomes: unknown[] = [];

  for (const [index, batch] of batches.entries()) {
    const response = await bulkSchedulePosts(batch.request);
    scheduled += response.totalScheduled;
    outcomes.push(...response.results);

    response.results.forEach((outcome, position) => {
      if (outcome.success) return;
      const row = batch.rows[position];
      failures.push({
        line: row?.line ?? position + 1,
        message: outcome.errorMessage ?? "failed",
      });
    });

    if (!isMachine()) {
      const label = `Batch ${index + 1}/${batches.length} (${batch.request.posts.length} posts)`;
      print(
        response.totalFailed === 0
          ? `${label}  ✓ ${response.totalScheduled} scheduled`
          : `${label}  ✓ ${response.totalScheduled} scheduled, ${response.totalFailed} failed`,
      );
    }
  }

  const firstSlot = rows
    .map((row) => row.item.scheduledAt)
    .sort()
    .find(Boolean);

  if (isMachine()) {
    printResult("post.bulk", outcomes, {
      total: rows.length,
      scheduled,
      failed: failures.length,
    });
  } else {
    if (failures.length > 0) {
      print("");
      for (const entry of failures) {
        failure(`row ${entry.line}  ${entry.message}`);
      }
    }

    print("");
    const summary = `${scheduled} scheduled · ${failures.length} failed`;
    print(
      firstSlot
        ? `${summary} · first goes out ${formatAbsolute(new Date(firstSlot), { timezone })}`
        : summary,
    );
  }

  if (failures.length > 0) {
    throw new CliError(`${failures.length} of ${rows.length} posts failed to schedule.`, {
      exitCode: ExitCode.GENERIC,
    });
  }
}

async function runBulkFromJson(path: string, options: BulkOptions): Promise<void> {
  const raw = await readSource(path);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(`${path} is not valid JSON: ${(error as Error).message}`, {
      exitCode: ExitCode.USAGE,
      cause: error,
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`${path} must hold a bulk schedule object.`, {
      exitCode: ExitCode.VALIDATION,
    });
  }

  const request = parsed as BulkSchedulePostsRequest;

  if (!Array.isArray(request.posts) || request.posts.length === 0) {
    throw new CliError(`${path} has no posts.`, { exitCode: ExitCode.VALIDATION });
  }

  if (!Array.isArray(request.platforms) || request.platforms.length === 0) {
    throw new CliError(`${path} has no platforms.`, { exitCode: ExitCode.VALIDATION });
  }

  request.timezone = assertTimeZone(request.timezone ?? resolveTimezone(options.timezone));

  const chunks: BulkSchedulePostsRequest[] = [];
  for (let start = 0; start < request.posts.length; start += BULK_CHUNK) {
    chunks.push({ ...request, posts: request.posts.slice(start, start + BULK_CHUNK) });
  }

  if (options.dryRun) {
    if (isMachine()) {
      printResult("post.bulk", chunks, { dryRun: true });
      return;
    }
    print(JSON.stringify(chunks, null, 2));
    hint(`dry run: ${chunks.length} request(s), nothing was sent`);
    return;
  }

  let scheduled = 0;
  let failed = 0;
  const outcomes: unknown[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const response = await bulkSchedulePosts(chunk);
    scheduled += response.totalScheduled;
    failed += response.totalFailed;
    outcomes.push(...response.results);

    response.results.forEach((outcome, position) => {
      if (outcome.success || isMachine()) return;
      failure(`row ${index * BULK_CHUNK + position + 1}  ${outcome.errorMessage ?? "failed"}`);
    });
  }

  if (isMachine()) {
    printResult("post.bulk", outcomes, {
      total: request.posts.length,
      scheduled,
      failed,
    });
  } else {
    print("");
    print(`${scheduled} scheduled · ${failed} failed`);
  }

  if (failed > 0) {
    throw new CliError(`${failed} of ${request.posts.length} posts failed to schedule.`, {
      exitCode: ExitCode.GENERIC,
    });
  }
}

const withContentOptions = (command: Command): Command =>
  command
    .option("-t, --text <text>", 'Post text, or "-" to read stdin')
    .option("-f, --file <path>", 'Markdown file with frontmatter, or "-" for stdin')
    .option("-P, --platform <platform>", "Target platform, repeatable", collectPlatform, [])
    .option("--type <type>", "TEXT, IMAGE, VIDEO or CAROUSEL")
    .option("-m, --media <path|url>", "Media to attach, repeatable", collect, [])
    .option("--thumbnail <path|url>", "Custom thumbnail for video posts")
    .option("--thumbnail-ms <ms>", "Take the thumbnail from the video at this millisecond")
    .option("-s, --at <when>", 'When to publish: ISO 8601, "+2h" or "tomorrow 09:00"')
    .option("--timezone <tz>", "IANA timezone stored with the post")
    .option("-a, --account <id>", "Connected account id, repeatable", collect, [])
    .option("--page <id>", "Facebook page id, repeatable", collect, [])
    .option("--text-for <PLATFORM=text>", "Per-platform text, repeatable", collect, [])
    .option("--config <PLATFORM=json>", "Per-platform config object, repeatable", collect, [])
    .option("--tiktok-privacy <level>", `TikTok privacy level (${TIKTOK_PRIVACY_LEVELS.join(", ")})`)
    .option("--ig-type <type>", `Instagram post type (${META_POST_TYPES.join(", ")})`)
    .option("--yt-title <title>", "YouTube video title")
    .option("--pinterest-board <id>", "Pinterest board id");

export function registerPostCommands(program: Command): void {
  const post = program.command("post").description("Create, schedule and inspect posts");

  post
    .command("list")
    .alias("ls")
    .description("List posts in this workspace")
    .option("--limit <n>", "Posts per page, 1 to 100")
    .option("--offset <n>", "Posts to skip")
    .option("--all", "Page until the server runs out")
    .option("--status <status>", "Filter by status, repeatable", collect, [])
    .option("--platform <platform>", "Filter by platform, repeatable", collectPlatform, [])
    .option("--from <date>", "Lower bound on scheduledAt")
    .option("--to <date>", "Upper bound on scheduledAt")
    .option("--sort <order>", "NEWEST or OLDEST", "NEWEST")
    .action(async (_options: ListOptions, command: Command) => {
      await runList(command.optsWithGlobals() as ListOptions);
    });

  post
    .command("view <id>")
    .alias("get")
    .description("Show one post with its per-platform targets")
    .action(async (id: string, _options: GlobalOptions, command: Command) => {
      await runView(id, command.optsWithGlobals() as GlobalOptions);
    });

  withContentOptions(post.command("create"))
    .description("Create a post from flags, a markdown file or stdin")
    .option("--draft", "Save as a draft instead of scheduling")
    .option("--watch", "Follow the post until every platform is done")
    .option("--timeout <duration>", "How long --watch waits", "30m")
    .option("--dry-run", "Print the request body and exit")
    .action(async (_options: CreateOptions, command: Command) => {
      await runCreate(command.optsWithGlobals() as CreateOptions);
    });

  withContentOptions(post.command("update <id>"))
    .description("Update a draft or scheduled post")
    .option("--dry-run", "Print the request body and exit")
    .action(async (id: string, _options: UpdateOptions, command: Command) => {
      await runUpdate(id, command.optsWithGlobals() as UpdateOptions);
    });

  post
    .command("delete <id>")
    .alias("rm")
    .description("Delete a post")
    .action(async (id: string, _options: GlobalOptions, command: Command) => {
      await runDelete(id, command.optsWithGlobals() as GlobalOptions);
    });

  post
    .command("publish <id>")
    .description("Publish a draft now, or schedule it")
    .option("-s, --at <when>", "Schedule instead of publishing now")
    .option("--timezone <tz>", "IANA timezone stored with the post")
    .action(async (id: string, _options: PublishOptions, command: Command) => {
      await runPublish(id, command.optsWithGlobals() as PublishOptions);
    });

  post
    .command("results <id>")
    .description("Per-platform publishing outcomes")
    .action(async (id: string, _options: GlobalOptions, command: Command) => {
      await runResults(id, command.optsWithGlobals() as GlobalOptions);
    });

  post
    .command("retry <id>")
    .description("Re-queue the platforms that failed")
    .option("--platform-id <id>", "Failed platform id, repeatable", collect, [])
    .option("--failed", "Retry every platform that ended FAILED")
    .action(async (id: string, _options: RetryOptions, command: Command) => {
      await runRetry(id, command.optsWithGlobals() as RetryOptions);
    });

  post
    .command("bulk")
    .description("Schedule many posts from a CSV, a JSON body or a directory")
    .option("--csv <path>", 'CSV file, or "-" for stdin')
    .option("--json-file <path>", "A raw bulk schedule request body")
    .option("--dir <path>", "Directory of markdown files")
    .option("-P, --platform <platform>", "Batch platform, repeatable", collectPlatform, [])
    .option("-a, --account <id>", "Batch account id, repeatable", collect, [])
    .option("--timezone <tz>", "IANA timezone stored with every post")
    .option("--dry-run", "Print the request bodies and exit")
    .action(async (_options: BulkOptions, command: Command) => {
      await runBulk(command.optsWithGlobals() as BulkOptions);
    });

  post
    .command("watch <id>")
    .description("Follow a post until every platform is published or failed")
    .option("--timeout <duration>", "Give up after this long", "30m")
    .option("--timezone <tz>", "Timezone for the printed times")
    .action(async (id: string, _options: WatchOptions, command: Command) => {
      await runWatch(id, command.optsWithGlobals() as WatchOptions);
    });
}
