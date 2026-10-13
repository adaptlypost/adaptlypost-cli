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
  unschedulePost,
  updatePost,
} from "../api/client.js";
import {
  CONTENT_TYPES,
  FIRST_COMMENT_MAX_LENGTH,
  GOOGLE_BUSINESS_CALL_TO_ACTION_TYPES,
  GOOGLE_BUSINESS_TOPIC_TYPES,
  INSTAGRAM_TRIAL_GRADUATIONS,
  META_POST_TYPES,
  POST_STATUSES,
  RECURRENCE_FREQUENCIES,
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
  type SocialPostPlatform,
  type UpdatePostRequest,
  type Weekday,
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
  RECURRENCE_MAX_INTERVAL,
  RECURRENCE_MAX_OCCURRENCES,
  CONFIG_FIELD,
  CONNECTION_FIELD,
  RECURRENCE_MIN_OCCURRENCES,
  assertCalendarDate,
  assertConfigKeys,
  assertExtrasFitPost,
  assertWholeNumberInRange,
  buildPlatformExtras,
  buildPostBody,
  buildTargets,
  inferContentTypeFromReferences,
  mergePostInput,
  normalizeAspectRatio,
  normalizeAspectRatioFit,
  normalizeContentType,
  normalizeFrequency,
  normalizePlatformName,
  normalizeWeekday,
  parsePostInput,
  readSource,
  readStdin,
  setFirstComment,
  setPlatformAspectRatio,
  setPlatformThumbnail,
  uploadLocalMedia,
  type PostInput,
} from "./post-input.js";
import { describeRecurrence } from "./recurring.js";

const TERMINAL_PLATFORM_STATUSES = new Set(["PUBLISHED", "FAILED"]);
const TERMINAL_POST_STATUSES = new Set<PostStatus>(["COMPLETED", "PARTIAL_FAILURE", "FAILED"]);
const BULK_CHUNK = 100;
const WATCH_LEAD_MS = 10_000;

const collect = (value: string, previous: string[]): string[] => [...previous, value];

const collectPlatform = (value: string, previous: PlatformType[]): PlatformType[] => [
  ...previous,
  normalizePlatformName(value),
];

const collectWeekday = (value: string, previous: Weekday[]): Weekday[] => {
  if (value.includes(",")) {
    throw new CliError(`--on takes one weekday, got "${value}".`, {
      exitCode: ExitCode.USAGE,
      hint: "Repeat the flag: --on MONDAY --on THURSDAY",
    });
  }
  return [...previous, normalizeWeekday(value)];
};

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
  alt: string[];
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
  igTrial?: string;
  ytTitle?: string;
  pinterestBoard?: string;
  documentTitle?: string;
  firstComment: string[];
  thumbnailFor: string[];
  thumbnailMsFor: string[];
  aspectRatio: string[];
  fit: string[];
  igShareToStory?: boolean;
  igCollaborator: string[];
  igAudio?: string;
  igAudioTitle?: string;
  igAudioArtist?: string;
  igAudioVolume?: string;
  igVideoVolume?: string;
  fbShareToStory?: boolean;
  fbTextBackground?: string;
  xKeepLinks?: boolean;
  gbpTopic?: string;
  gbpCta?: string;
  gbpCtaUrl?: string;
  gbpEventTitle?: string;
  gbpEventStart?: string;
  gbpEventEnd?: string;
  gbpCoupon?: string;
  gbpRedeemUrl?: string;
  gbpTerms?: string;
  repeat?: string;
  every?: string;
  on?: Weekday[];
  until?: string;
  count?: string;
}

function recurrenceFromOptions(options: ContentOptions): PostInput["recurrence"] {
  if (options.until !== undefined && options.count !== undefined) {
    throw new CliError("Pass --until or --count, not both.", { exitCode: ExitCode.USAGE });
  }

  const recurrence: NonNullable<PostInput["recurrence"]> = {};

  if (options.repeat !== undefined) recurrence.frequency = normalizeFrequency(options.repeat);
  if (options.every !== undefined) {
    recurrence.interval = assertWholeNumberInRange(
      Number(options.every),
      "--every",
      1,
      RECURRENCE_MAX_INTERVAL,
      ExitCode.USAGE,
    );
  }
  if (options.on !== undefined && options.on.length > 0) recurrence.weekdays = options.on;
  if (options.until !== undefined) {
    recurrence.endsOn = assertCalendarDate(options.until, "--until", ExitCode.USAGE);
  }
  if (options.count !== undefined) {
    recurrence.maxOccurrences = assertWholeNumberInRange(
      Number(options.count),
      "--count",
      RECURRENCE_MIN_OCCURRENCES,
      RECURRENCE_MAX_OCCURRENCES,
      ExitCode.USAGE,
    );
  }

  return Object.keys(recurrence).length > 0 ? recurrence : undefined;
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
  if (options.alt.length > 0) input.alt = options.alt;
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

  if (options.igTrial !== undefined) {
    const trialGraduation = options.igTrial.trim().toUpperCase();
    if (!(INSTAGRAM_TRIAL_GRADUATIONS as readonly string[]).includes(trialGraduation)) {
      throw new CliError(
        `Unknown Instagram trial graduation "${options.igTrial}". Expected one of: ${INSTAGRAM_TRIAL_GRADUATIONS.join(", ")}.`,
        { exitCode: ExitCode.USAGE },
      );
    }
    mergeConfig("INSTAGRAM", { trialGraduation });
  }

  if (options.ytTitle !== undefined) mergeConfig("YOUTUBE", { videoTitle: options.ytTitle });
  if (options.pinterestBoard !== undefined) {
    mergeConfig("PINTEREST", { boardId: options.pinterestBoard });
  }
  if (options.documentTitle !== undefined) {
    mergeConfig("LINKEDIN", { documentTitle: options.documentTitle });
  }

  if (options.igShareToStory !== undefined) mergeConfig("INSTAGRAM", { shareToStory: options.igShareToStory });
  if (options.igCollaborator.length > 0) mergeConfig("INSTAGRAM", { collaborators: options.igCollaborator });

  const audioDetails = [options.igAudioTitle, options.igAudioArtist, options.igAudioVolume, options.igVideoVolume];
  if (options.igAudio === undefined && audioDetails.some((value) => value !== undefined)) {
    throw new CliError("--ig-audio-title, --ig-audio-artist and the volume flags need --ig-audio <audioId>.", {
      exitCode: ExitCode.USAGE,
      hint: "Find an audio id with: adaptlypost accounts instagram-audio <id>",
    });
  }
  if (options.igAudio !== undefined) {
    const volume = (value: string | undefined, flag: string): number | undefined =>
      value === undefined ? undefined : assertWholeNumberInRange(Number(value), flag, 1, 100, ExitCode.USAGE);
    mergeConfig("INSTAGRAM", {
      audio: Object.fromEntries(
        Object.entries({
          audioId: options.igAudio,
          title: options.igAudioTitle,
          artist: options.igAudioArtist,
          audioVolume: volume(options.igAudioVolume, "--ig-audio-volume"),
          videoVolume: volume(options.igVideoVolume, "--ig-video-volume"),
        }).filter(([, value]) => value !== undefined),
      ),
    });
  }

  if (options.fbShareToStory !== undefined) mergeConfig("FACEBOOK", { shareToStory: options.fbShareToStory });
  if (options.fbTextBackground !== undefined) {
    mergeConfig("FACEBOOK", { textFormatPresetId: options.fbTextBackground });
  }

  const googleBusiness = Object.fromEntries(
    Object.entries({
      topicType: options.gbpTopic,
      callToActionType: options.gbpCta,
      callToActionUrl: options.gbpCtaUrl,
      eventTitle: options.gbpEventTitle,
      eventStart: options.gbpEventStart,
      eventEnd: options.gbpEventEnd,
      offerCouponCode: options.gbpCoupon,
      offerRedeemUrl: options.gbpRedeemUrl,
      offerTerms: options.gbpTerms,
    }).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(googleBusiness).length > 0) mergeConfig("GOOGLE_BUSINESS", googleBusiness);

  if (Object.keys(configs).length > 0) input.platformConfigs = configs;

  if (options.xKeepLinks !== undefined) input.twitterKeepLinks = options.xKeepLinks;

  for (const entry of options.firstComment) {
    const [platform, text] = parsePair(entry, "--first-comment");
    setFirstComment(input, normalizePlatformName(platform), text);
  }

  for (const entry of options.thumbnailFor) {
    const [platform, thumbnailUrl] = parsePair(entry, "--thumbnail-for");
    setPlatformThumbnail(input, normalizePlatformName(platform), { thumbnailUrl });
  }

  for (const entry of options.thumbnailMsFor) {
    const [platform, raw] = parsePair(entry, "--thumbnail-ms-for");
    const ms = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(ms) || ms < 0) {
      throw new CliError(`--thumbnail-ms-for ${platform} must be a whole number of milliseconds.`, {
        exitCode: ExitCode.USAGE,
      });
    }
    setPlatformThumbnail(input, normalizePlatformName(platform), { thumbnailTimestampMs: ms });
  }

  for (const entry of options.aspectRatio) {
    const [platform, ratio] = parsePair(entry, "--aspect-ratio");
    setPlatformAspectRatio(input, normalizePlatformName(platform), { aspectRatio: normalizeAspectRatio(ratio) });
  }

  for (const entry of options.fit) {
    const [platform, fit] = parsePair(entry, "--fit");
    setPlatformAspectRatio(input, normalizePlatformName(platform), { fit: normalizeAspectRatioFit(fit) });
  }

  const recurrence = recurrenceFromOptions(options);
  if (recurrence) input.recurrence = recurrence;

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

  for (const [platform, config] of Object.entries(merged.platformConfigs ?? {})) {
    assertConfigKeys(platform as PlatformType, config);
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
    ...(post.recurringPostId ? [["recurring", formatId(post.recurringPostId)] as [string, string]] : []),
  ]);

  const targets = post.platforms ?? [];
  if (targets.length === 0) return;

  print("");
  printTable(targets, [
    { header: "PLATFORM", value: platformLabel },
    { header: "ACCOUNT", value: (target) => target.accountName ?? target.connectionId ?? target.pageId ?? "—" },
    { header: "STATUS", value: (target) => target.status },
    { header: "CHARS", value: (target) => (target.text ?? post.text ?? "").length, align: "right" },
    { header: "POST ID", value: (target) => target.platformPostId ?? "—" },
    ...(targets.some((target) => target.firstCommentStatus)
      ? [{ header: "FIRST COMMENT", value: firstCommentCell }]
      : []),
    { header: "ERROR", value: (target) => target.errorMessage ?? "—" },
  ]);
}

const platformLabel = (target: SocialPostPlatform): string => {
  const postType = target.platform === "INSTAGRAM" ? target.instagramPostType : target.facebookPostType;
  return (target.platform === "INSTAGRAM" || target.platform === "FACEBOOK") && postType === "STORY"
    ? `${target.platform} story`
    : target.platform;
};

const firstCommentCell = (target: SocialPostPlatform): string => {
  if (!target.firstCommentStatus) return "—";
  if (target.firstCommentStatus === "FAILED" && target.firstCommentError) {
    return `FAILED: ${target.firstCommentError}`;
  }
  return target.firstCommentStatus;
};

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

    if (created.recurringPostId && body.recurrence) {
      entries.push(["repeats", describeRecurrence(body.recurrence)]);
      entries.push(["recurring", formatId(created.recurringPostId)]);
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

type ConfigEntry = Record<string, unknown>;

const definedOnly = (entry: ConfigEntry): ConfigEntry =>
  Object.fromEntries(
    Object.entries(entry).filter(
      ([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0),
    ),
  );

function storedConfig(target: SocialPostPlatform): ConfigEntry | undefined {
  switch (target.platform) {
    case "FACEBOOK":
      return definedOnly({
        postType: target.facebookPostType,
        videoTitle: target.facebookVideoTitle,
        textFormatPresetId: target.facebookTextFormatPresetId,
      });
    case "INSTAGRAM":
      return definedOnly({
        postType: target.instagramPostType,
        trialGraduation: target.instagramTrialGraduation,
        collaborators: target.instagramCollaborators,
        audio:
          target.instagramAudioId === undefined
            ? undefined
            : definedOnly({
                audioId: target.instagramAudioId,
                title: target.instagramAudioTitle,
                artist: target.instagramAudioArtist,
                audioVolume: target.instagramAudioVolume,
                videoVolume: target.instagramVideoVolume,
              }),
      });
    case "TIKTOK":
      return target.tiktokPrivacyLevel === undefined
        ? undefined
        : definedOnly({
            privacyLevel: target.tiktokPrivacyLevel,
            title: target.tiktokTitle,
            caption: target.tiktokCaption,
            allowComments: target.tiktokAllowComments,
            allowDuet: target.tiktokAllowDuet,
            allowStitch: target.tiktokAllowStitch,
            sendAsDraft: target.tiktokSendAsDraft,
            aiGenerated: target.tiktokAiGenerated,
            brandedContent: target.tiktokBrandedContent,
            brandedContentOwnBrand: target.tiktokBrandedOwnBrand,
            autoAddMusic: target.tiktokAutoAddMusic,
          });
    case "PINTEREST":
      return definedOnly({ boardId: target.pinterestBoardId, title: target.pinterestTitle, link: target.pinterestLink });
    case "YOUTUBE":
      return definedOnly({
        postType: target.youtubePostType,
        videoTitle: target.youtubeVideoTitle,
        tags: target.youtubeTags,
        privacyStatus: target.youtubePrivacyStatus,
        license: target.youtubeLicense,
        notifySubscribers: target.youtubeNotifySubscribers,
        allowEmbedding: target.youtubeAllowEmbedding,
        madeForKids: target.youtubeMadeForKids,
        categoryId: target.youtubeCategoryId,
        playlistId: target.youtubePlaylistId,
      });
    case "LINKEDIN":
      return definedOnly({ documentTitle: target.linkedinDocumentTitle });
    case "GOOGLE_BUSINESS":
      return target.googleBusinessTopicType === undefined
        ? undefined
        : definedOnly({
            topicType: target.googleBusinessTopicType,
            callToActionType: target.googleBusinessCallToActionType,
            callToActionUrl: target.googleBusinessCallToActionUrl,
            eventTitle: target.googleBusinessEventTitle,
            eventStart: target.googleBusinessEventStart,
            eventEnd: target.googleBusinessEventEnd,
            offerCouponCode: target.googleBusinessOfferCouponCode,
            offerRedeemUrl: target.googleBusinessOfferRedeemUrl,
            offerTerms: target.googleBusinessOfferTerms,
          });
    default:
      return undefined;
  }
}

/** Rebuilds the targets of a stored post, because the API only applies alt text when targets are resent. */
export function targetsFromPost(post: SocialPost): {
  platforms: PlatformType[];
  targets: PostTargets;
  platformTexts: PlatformText[];
} {
  const targets: Record<string, unknown[]> = {};
  const platformTexts = new Map<PlatformType, string>();

  const push = (field: string, value: unknown): void => {
    targets[field] = [...(targets[field] ?? []), value];
  };

  const unreachable = [
    ...new Set((post.platforms ?? []).map((target) => target.platform).filter((platform) => !CONNECTION_FIELD[platform])),
  ];
  if (unreachable.length > 0) {
    throw new CliError(
      `This post also goes to ${unreachable.join(", ")}, which the API cannot target, so its targets cannot be resent.`,
      { exitCode: ExitCode.VALIDATION, hint: "Change the alt text in the AdaptlyPost app" },
    );
  }

  const groups = new Map<string, SocialPostPlatform[]>();
  for (const target of post.platforms ?? []) {
    const id = target.platform === "FACEBOOK" ? target.pageId : target.connectionId;
    if (id === undefined) continue;
    const key = `${target.platform}:${id}`;
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }

  for (const entries of groups.values()) {
    const isStory = (target: SocialPostPlatform): boolean =>
      (target.platform === "INSTAGRAM" ? target.instagramPostType : target.facebookPostType) === "STORY";
    const primary = entries.find((target) => !isStory(target)) ?? entries[0];
    if (!primary) continue;
    const id = (primary.platform === "FACEBOOK" ? primary.pageId : primary.connectionId) as string;
    const connectionField = CONNECTION_FIELD[primary.platform] as string;

    push(connectionField, id);

    const field = CONFIG_FIELD[primary.platform];
    const config = storedConfig(primary);
    if (config && !isStory(primary) && entries.some(isStory)) config.shareToStory = true;
    if (field && config && Object.keys(config).length > 0) {
      push(field, primary.platform === "FACEBOOK" ? { pageId: id, ...config } : { connectionId: id, ...config });
    }

    if (primary.text && !platformTexts.has(primary.platform)) platformTexts.set(primary.platform, primary.text);
  }

  const platforms = [...new Set((post.platforms ?? []).map((target) => target.platform))].filter(
    (platform) => (targets[CONNECTION_FIELD[platform] as string] ?? []).length > 0,
  );

  return {
    platforms,
    targets: targets as PostTargets,
    platformTexts: [...platformTexts].map(([platform, text]) => ({ platform, text })),
  };
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

  if (input.recurrence) {
    throw new CliError("A post can only be made recurring when it is created.", {
      exitCode: ExitCode.USAGE,
      hint: "Drop the repeat keys from the file. Manage a series with: adaptlypost recurring",
    });
  }

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
  if (input.twitterKeepLinks !== undefined) body.twitterKeepLinks = input.twitterKeepLinks;
  if (input.firstComments !== undefined) body.firstComments = full.firstComments;
  if (input.platformThumbnails !== undefined) body.platformThumbnails = full.platformThumbnails;
  if (input.platformAspectRatios !== undefined) body.platformAspectRatios = full.platformAspectRatios;

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

  if (input.alt?.length) {
    body.mediaAltTexts = input.alt;

    if (body.platforms === undefined) {
      if (targetsChanged) {
        throw new CliError("Alt text is only saved together with the full target set.", {
          exitCode: ExitCode.USAGE,
          hint: "Add --platform for every platform of the post, or drop --account to keep the current targets",
        });
      }
      const current = await getPost(id);
      const kept = targetsFromPost(current);
      if (kept.platforms.length === 0) {
        throw new CliError("This post has no targets to attach alt text to.", {
          exitCode: ExitCode.VALIDATION,
          hint: "Pass --platform and --account with --alt",
        });
      }
      Object.assign(body, kept.targets);
      body.platforms = kept.platforms;
      if (kept.platformTexts.length > 0 && body.platformTexts === undefined) {
        body.platformTexts = kept.platformTexts;
      }
    }
  }

  if (Object.keys(body).length === 0) {
    throw new CliError("Nothing to update.", {
      exitCode: ExitCode.USAGE,
      hint: "Pass at least one of --text, --file, --at, --timezone, --type, --thumbnail, --alt, --first-comment, --thumbnail-for, --aspect-ratio, --x-keep-links or --platform",
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

async function runUnschedule(id: string): Promise<void> {
  const post = await unschedulePost(id);

  if (isMachine()) {
    printResult("post.unschedule", post);
    return;
  }

  success(`Unscheduled  ${formatId(post.id)}`);
  printKeyValues([
    ["status", post.status],
    ["publish", `adaptlypost post publish ${post.id} --at <when>`],
  ]);
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
  platform: PlatformType[];
  failed?: boolean;
}

async function runRetry(id: string, options: RetryOptions): Promise<void> {
  let platformIds: string[] = [...options.platformId, ...options.platform];

  if (options.failed) {
    const response = await listPostResults(id);
    platformIds = [
      ...new Set([
        ...platformIds,
        ...response.results.filter((result) => result.status === "FAILED").map((result) => result.platformId),
      ]),
    ];
  }

  const retried = await retryFailedPlatforms(id, platformIds.length > 0 ? { platformIds } : {});

  if (isMachine()) {
    printResult("post.retry", retried);
    return;
  }

  const scope = platformIds.length > 0 ? `${platformIds.length} platform(s)` : "every failed platform";
  success(`Retrying ${scope} on ${formatId(retried.postId)}`);
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

const CORE_COLUMNS = new Set(["text", "scheduledAt", "contentType", "media", "alt", "thumbnail", "thumbnailMs"]);

const splitList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

interface BulkRow {
  line: number;
  item: BulkPostInput;
  mediaRefs: string[];
  configs: PostInput["platformConfigs"];
}

function refuseDocumentRows(rows: BulkRow[]): void {
  for (const row of rows) {
    if (row.item.contentType === "DOCUMENT" || row.configs?.LINKEDIN) {
      throw new CliError(`Row ${row.line}: LinkedIn document posts cannot be bulk scheduled.`, {
        exitCode: ExitCode.VALIDATION,
        hint: 'Create each one with "adaptlypost post create --type DOCUMENT"',
      });
    }
  }
}

const PLATFORM_COLUMN_PREFIXES = ["text", "config", "firstComment", "thumbnail", "thumbnailMs", "aspectRatio", "fit"] as const;
type PlatformColumnPrefix = (typeof PLATFORM_COLUMN_PREFIXES)[number];

const PLATFORM_COLUMN = /^([A-Za-z]+)_([A-Za-z_]+)$/;

function platformColumn(header: string): { prefix: PlatformColumnPrefix; platform: string } | undefined {
  const match = PLATFORM_COLUMN.exec(header);
  const prefix = match?.[1] as PlatformColumnPrefix | undefined;
  if (!match || !prefix || !PLATFORM_COLUMN_PREFIXES.includes(prefix)) return undefined;
  return { prefix, platform: match[2] ?? "" };
}

function readBulkColumns(headers: string[]): void {
  const unknown = headers.filter((header) => !CORE_COLUMNS.has(header) && !platformColumn(header));

  if (unknown.length > 0) {
    throw new CliError(`Unknown CSV column(s): ${unknown.join(", ")}.`, {
      exitCode: ExitCode.VALIDATION,
      hint: `Known columns: ${[...CORE_COLUMNS].join(", ")}, ${PLATFORM_COLUMN_PREFIXES.map((prefix) => `${prefix}_<PLATFORM>`).join(", ")}`,
    });
  }
}

function bulkRowFromRecord(
  record: Record<string, string>,
  line: number,
  timezone: string,
): BulkRow {
  const text = (record.text ?? "").trim();
  const mediaRefs = splitList(record.media);
  const alt = splitList(record.alt);

  if (alt.length > 0 && alt.length > mediaRefs.length) {
    throw new CliError(`Row ${line}: ${alt.length} alt texts for ${mediaRefs.length} media file(s).`, {
      exitCode: ExitCode.VALIDATION,
      hint: "Give one alt text per media file, in the same order, separated by ;",
    });
  }

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
    : inferContentTypeFromReferences(mediaRefs);

  const platformTexts: PlatformText[] = [];
  const configs: PostInput["platformConfigs"] = {};
  const extrasInput: PostInput = {};

  for (const [column, value] of Object.entries(record)) {
    if (value.trim() === "") continue;

    const target = platformColumn(column);
    if (!target) continue;
    const platform = normalizePlatformName(target.platform);

    if (target.prefix === "text") {
      platformTexts.push({ platform, text: value });
      continue;
    }

    if (target.prefix === "firstComment") {
      setFirstComment(extrasInput, platform, value);
      continue;
    }

    if (target.prefix === "thumbnail") {
      setPlatformThumbnail(extrasInput, platform, { thumbnailUrl: value.trim() });
      continue;
    }

    if (target.prefix === "thumbnailMs") {
      const ms = Number(value);
      if (!Number.isInteger(ms) || ms < 0) {
        throw new CliError(`Row ${line}: ${column} must be a whole number.`, { exitCode: ExitCode.VALIDATION });
      }
      setPlatformThumbnail(extrasInput, platform, { thumbnailTimestampMs: ms });
      continue;
    }

    if (target.prefix === "aspectRatio") {
      setPlatformAspectRatio(extrasInput, platform, { aspectRatio: normalizeAspectRatio(value, ExitCode.VALIDATION) });
      continue;
    }

    if (target.prefix === "fit") {
      setPlatformAspectRatio(extrasInput, platform, { fit: normalizeAspectRatioFit(value, ExitCode.VALIDATION) });
      continue;
    }

    if (target.prefix === "config") {
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
      assertConfigKeys(platform, parsed, `Row ${line}: `);
      configs[platform] = parsed as Record<string, never>;
    }
  }

  const item: BulkPostInput = { contentType, scheduledAt };
  if (text !== "") item.text = text;
  if (alt.length > 0) item.mediaAltTexts = alt;
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

  const extras = buildPlatformExtras(extrasInput, `Row ${line}: `);
  assertExtrasFitPost(extras, contentType, undefined, `Row ${line}: `);
  Object.assign(item, extras);

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

    if (input.recurrence) {
      throw new CliError(`${name}: recurring posts cannot be bulk scheduled.`, {
        exitCode: ExitCode.VALIDATION,
        hint: 'Create each one with "adaptlypost post create --repeat"',
      });
    }

    if (input.at === undefined) {
      throw new CliError(`${name} has no "at" in its frontmatter.`, {
        exitCode: ExitCode.VALIDATION,
      });
    }

    if (input.twitterKeepLinks !== undefined) {
      throw new CliError(`${name}: keeping X links is not available for bulk scheduling.`, {
        exitCode: ExitCode.VALIDATION,
        hint: 'Create the post with "adaptlypost post create --x-keep-links"',
      });
    }

    for (const [platform, config] of Object.entries(input.platformConfigs ?? {})) {
      assertConfigKeys(platform as PlatformType, config, `${name}: `);
    }

    const item: BulkPostInput = {
      contentType: input.contentType ?? inferContentTypeFromReferences(input.media ?? []),
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

    if (input.media?.length && input.alt?.length) item.mediaAltTexts = input.alt;

    const extras = buildPlatformExtras(input, `${name}: `);
    assertExtrasFitPost(extras, item.contentType, undefined, `${name}: `);
    Object.assign(item, extras);

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

  refuseDocumentRows(rows);

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
    .option("--type <type>", `${CONTENT_TYPES.join(", ")}. DOCUMENT is LinkedIn only: one PDF, PPT, PPTX, DOC or DOCX`)
    .option("-m, --media <path|url>", "Media to attach, repeatable", collect, [])
    .option("--alt <text>", "Alt text for the image at the same position as --media, repeatable", collect, [])
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
    .option(
      "--ig-trial <graduation>",
      `Publish an Instagram video reel as a trial reel: MANUAL (you share it from the app) or SS_PERFORMANCE (Instagram shares it if it performs well)`,
    )
    .option("--yt-title <title>", "YouTube video title")
    .option(
      "--pinterest-board <id>",
      "Pinterest board id. Without it the pin goes to a board named AdaptlyPost. Find ids with: accounts pinterest-boards",
    )
    .option(
      "--document-title <title>",
      "LinkedIn document title, max 100 characters. Defaults to the file name; ignored for non-DOCUMENT posts",
    )
    .option(
      "--first-comment <PLATFORM=text>",
      `Comment posted from the same account right after the post, one flag per platform. Works on ${Object.entries(FIRST_COMMENT_MAX_LENGTH).map(([platform, limit]) => `${platform} (${limit})`).join(", ")}`,
      collect,
      [],
    )
    .option(
      "--thumbnail-for <PLATFORM=url>",
      "Video thumbnail image for one platform, repeatable. YOUTUBE, FACEBOOK, LINKEDIN, INSTAGRAM, PINTEREST",
      collect,
      [],
    )
    .option(
      "--thumbnail-ms-for <PLATFORM=ms>",
      "Video frame to use as one platform's thumbnail, repeatable. INSTAGRAM, PINTEREST, TIKTOK",
      collect,
      [],
    )
    .option(
      "--aspect-ratio <PLATFORM=ratio>",
      "Reframe the images on one platform, repeatable: SQUARE, PORTRAIT, VERTICAL or LANDSCAPE. INSTAGRAM (no VERTICAL) and TIKTOK",
      collect,
      [],
    )
    .option(
      "--fit <PLATFORM=fit>",
      "How --aspect-ratio reframes on that platform: CROP (default, cut from the center) or PAD (keep the whole image)",
      collect,
      [],
    )
    .option("--ig-share-to-story", "Also publish the Instagram media as a story next to the feed post or reel")
    .option(
      "--ig-collaborator <username>",
      "Invite an Instagram account as a collaborator, repeatable, up to 3",
      collect,
      [],
    )
    .option("--ig-audio <audioId>", "Add music or an original sound to an Instagram reel. Find ids with: accounts instagram-audio")
    .option("--ig-audio-title <title>", "Track title stored with --ig-audio, for display only")
    .option("--ig-audio-artist <artist>", "Artist stored with --ig-audio, for display only")
    .option("--ig-audio-volume <1-100>", "Volume of the added audio. Defaults to 100")
    .option("--ig-video-volume <1-100>", "Volume of the reel's own sound. Defaults to 100")
    .option("--fb-share-to-story", "Also publish the Facebook media as a story next to the feed post or reel")
    .option(
      "--fb-text-background <presetId>",
      "Facebook colored text background id, for example 106018623298955. TEXT posts up to 130 characters, no media",
    )
    .option(
      "--x-keep-links",
      "Keep links in the X text clickable. AppSumo lifetime deals only; a kept link costs 20 credits instead of 2",
    )
    .option("--no-x-keep-links", "Break links in the X text again (the default)")
    .option(
      "--gbp-topic <type>",
      `Google Business Profile post type: ${GOOGLE_BUSINESS_TOPIC_TYPES.join(", ")}. Defaults to STANDARD (an update)`,
    )
    .option("--gbp-cta <type>", `Google Business Profile button: ${GOOGLE_BUSINESS_CALL_TO_ACTION_TYPES.join(", ")}`)
    .option("--gbp-cta-url <url>", "Link for the --gbp-cta button. Every button except CALL needs one")
    .option("--gbp-event-title <title>", "Event or offer title. EVENT and OFFER need it")
    .option(
      "--gbp-event-start <date>",
      "Event or offer start, YYYY-MM-DD or YYYY-MM-DDTHH:mm in the business's local time",
    )
    .option("--gbp-event-end <date>", "Event or offer end, YYYY-MM-DD or YYYY-MM-DDTHH:mm in the business's local time")
    .option("--gbp-coupon <code>", "Coupon code for an OFFER")
    .option("--gbp-redeem-url <url>", "Where to redeem an OFFER")
    .option("--gbp-terms <text>", "Terms and conditions of an OFFER");

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
    .option("--repeat <frequency>", `Repeat the post: ${RECURRENCE_FREQUENCIES.join(", ")}. Needs --at, which sets the first post and its time of day`)
    .option("--every <n>", `Repeat every n days, weeks, months or years, 1 to ${RECURRENCE_MAX_INTERVAL}. Defaults to 1`)
    .option("--on <weekday>", "Weekday for a WEEKLY repeat, repeatable. The weekday of --at is always included", collectWeekday, [])
    .option("--until <YYYY-MM-DD>", "Last day a post of the series may go out. Cannot be combined with --count")
    .option("--count <n>", `Total posts in the series, ${RECURRENCE_MIN_OCCURRENCES} to ${RECURRENCE_MAX_OCCURRENCES}. Cannot be combined with --until`)
    .option("--watch", "Follow the post until every platform is done")
    .option("--timeout <duration>", "How long --watch waits", "30m")
    .option("--dry-run", "Print the request body and exit")
    .action(async (_options: CreateOptions, command: Command) => {
      await runCreate(command.optsWithGlobals() as CreateOptions);
    });

  withContentOptions(post.command("update <id>"))
    .description("Update a draft or scheduled post. A scheduled post cannot move into the past")
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
    .command("unschedule <id>")
    .description("Turn a scheduled post back into an undated draft")
    .action(async (id: string) => {
      await runUnschedule(id);
    });

  post
    .command("results <id>")
    .description("Per-platform publishing outcomes")
    .action(async (id: string, _options: GlobalOptions, command: Command) => {
      await runResults(id, command.optsWithGlobals() as GlobalOptions);
    });

  post
    .command("retry <id>")
    .description("Re-queue the platforms that failed; with no flags every FAILED platform is retried")
    .option("--platform-id <id>", "Failed platform id from `post results`, repeatable", collect, [])
    .option("-P, --platform <platform>", "Retry every failed entry of this platform, repeatable", collectPlatform, [])
    .option("--failed", "Resolve the FAILED platform ids locally before sending")
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
