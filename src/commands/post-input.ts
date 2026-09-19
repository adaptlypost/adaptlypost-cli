import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";

import { createUploadUrls } from "../api/client.js";
import {
  CONTENT_TYPES,
  PLATFORM_TYPES,
  type ContentType,
  type CreatePostRequest,
  type FacebookPostConfig,
  type InstagramPostConfig,
  type PinterestPostConfig,
  type PlatformText,
  type PlatformType,
  type PostTargets,
  type SocialAccount,
  type TikTokPostConfig,
  type UpdatePostRequest,
  type UploadMimeType,
  type YouTubePostConfig,
} from "../api/types.js";
import { CliError, ExitCode } from "../core/index.js";

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | FrontmatterMap;

export interface FrontmatterMap {
  [key: string]: FrontmatterValue;
}

export interface Frontmatter {
  data: FrontmatterMap;
  body: string;
}

export interface PostInput {
  text?: string;
  platforms?: PlatformType[];
  accounts?: string[];
  contentType?: ContentType;
  at?: string;
  timezone?: string;
  media?: string[];
  alt?: string[];
  thumbnail?: string;
  thumbnailMs?: number;
  draft?: boolean;
  platformTexts?: Partial<Record<PlatformType, string>>;
  platformConfigs?: Partial<Record<PlatformType, Record<string, FrontmatterValue>>>;
}

export const CONNECTION_FIELD: Record<PlatformType, keyof PostTargets> = {
  FACEBOOK: "pageIds",
  INSTAGRAM: "instagramConnectionIds",
  THREADS: "threadsConnectionIds",
  TIKTOK: "tiktokConnectionIds",
  TWITTER: "twitterConnectionIds",
  BLUESKY: "blueskyConnectionIds",
  LINKEDIN: "linkedinConnectionIds",
  PINTEREST: "pinterestConnectionIds",
  YOUTUBE: "youtubeConnectionIds",
};

export const CONFIG_FIELD: Partial<Record<PlatformType, keyof PostTargets>> = {
  FACEBOOK: "facebookConfigs",
  INSTAGRAM: "instagramConfigs",
  TIKTOK: "tiktokConfigs",
  PINTEREST: "pinterestConfigs",
  YOUTUBE: "youtubeConfigs",
};

const PLATFORM_ALIASES: Record<string, PlatformType> = {
  x: "TWITTER",
  fb: "FACEBOOK",
  ig: "INSTAGRAM",
  li: "LINKEDIN",
  yt: "YOUTUBE",
  tt: "TIKTOK",
};

const SCALAR_KEYS = new Map<string, keyof PostInput>([
  ["text", "text"],
  ["platforms", "platforms"],
  ["platform", "platforms"],
  ["accounts", "accounts"],
  ["account", "accounts"],
  ["connections", "accounts"],
  ["pages", "accounts"],
  ["page", "accounts"],
  ["type", "contentType"],
  ["contenttype", "contentType"],
  ["at", "at"],
  ["schedule", "at"],
  ["scheduledat", "at"],
  ["timezone", "timezone"],
  ["tz", "timezone"],
  ["media", "media"],
  ["mediaurls", "media"],
  ["alt", "alt"],
  ["alts", "alt"],
  ["alttext", "alt"],
  ["alttexts", "alt"],
  ["mediaalttexts", "alt"],
  ["thumbnail", "thumbnail"],
  ["thumbnailurl", "thumbnail"],
  ["thumbnailms", "thumbnailMs"],
  ["thumbnailtimestampms", "thumbnailMs"],
  ["draft", "draft"],
  ["saveasdraft", "draft"],
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const KEY_LINE = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/;

export function normalizePlatformName(value: string): PlatformType {
  const raw = value.trim();
  const alias = PLATFORM_ALIASES[raw.toLowerCase()];
  const platform = alias ?? (raw.toUpperCase() as PlatformType);

  if (!(PLATFORM_TYPES as readonly string[]).includes(platform)) {
    throw new CliError(
      `Unknown platform "${value}". Expected one of: ${PLATFORM_TYPES.join(", ")}.`,
      { exitCode: ExitCode.USAGE },
    );
  }

  return platform;
}

export function normalizeContentType(value: string): ContentType {
  const contentType = value.trim().toUpperCase() as ContentType;

  if (!(CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new CliError(
      `Unknown content type "${value}". Expected one of: ${CONTENT_TYPES.join(", ")}.`,
      { exitCode: ExitCode.USAGE },
    );
  }

  return contentType;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

const isBlank = (line: string): boolean => line.trim() === "" || line.trim().startsWith("#");

function splitInline(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;

  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim() !== "" || parts.length > 0) parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

function stripComment(raw: string): string {
  let quote: string | null = null;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || raw[index - 1] === " ")) {
      return raw.slice(0, index);
    }
  }

  return raw;
}

function unquote(raw: string): string {
  const quote = raw[0];
  const inner = raw.slice(1, -1);

  if (quote === "'") return inner.replace(/''/g, "'");

  return inner.replace(/\\(["\\ntr])/g, (_match, escaped: string) => {
    if (escaped === "n") return "\n";
    if (escaped === "t") return "\t";
    if (escaped === "r") return "\r";
    return escaped;
  });
}

export function parseScalar(raw: string): FrontmatterValue {
  const value = stripComment(raw).trim();

  if (value === "") return null;

  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return unquote(value);
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInline(value.slice(1, -1)).map((item) => parseScalar(item));
  }

  const lower = value.toLowerCase();
  if (lower === "true" || lower === "yes" || lower === "on") return true;
  if (lower === "false" || lower === "no" || lower === "off") return false;
  if (lower === "null" || lower === "~") return null;

  if (ISO_DATE.test(value)) return value;
  if (NUMBER.test(value)) return Number(value);

  return value;
}

function parseBlockScalar(lines: string[], start: number, style: string): { value: string; next: number } {
  const collected: string[] = [];
  let index = start;
  let baseIndent: number | null = null;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      collected.push("");
      index += 1;
      continue;
    }
    const indent = indentOf(line);
    if (baseIndent === null) baseIndent = indent;
    if (indent < baseIndent) break;
    collected.push(line.slice(baseIndent));
    index += 1;
  }

  while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();

  const folded = style.startsWith(">")
    ? collected.reduce((accumulator: string[], line) => {
        if (line === "") {
          accumulator.push("");
          return accumulator;
        }
        const last = accumulator[accumulator.length - 1];
        if (last === undefined || last === "") accumulator.push(line);
        else accumulator[accumulator.length - 1] = `${last} ${line}`;
        return accumulator;
      }, [])
    : collected;

  const text = folded.join("\n");

  return { value: style.endsWith("-") ? text : `${text}\n`, next: index };
}

function parseMap(lines: string[], start: number, baseIndent: number): { value: FrontmatterMap; next: number } {
  const map: FrontmatterMap = {};
  let index = start;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const indent = indentOf(line);
    if (indent < baseIndent) break;

    const match = KEY_LINE.exec(line.trim());
    if (!match) {
      throw new CliError(`Frontmatter line ${index + 1} is not "key: value": ${line.trim()}`, {
        exitCode: ExitCode.VALIDATION,
      });
    }

    const [, key, rest = ""] = match;
    index += 1;

    const trimmedRest = rest.trim();

    if (trimmedRest === "|" || trimmedRest === "|-" || trimmedRest === ">" || trimmedRest === ">-") {
      const block = parseBlockScalar(lines, index, trimmedRest);
      map[key] = block.value;
      index = block.next;
      continue;
    }

    if (trimmedRest !== "") {
      map[key] = parseScalar(trimmedRest);
      continue;
    }

    let lookahead = index;
    while (lookahead < lines.length && isBlank(lines[lookahead] ?? "")) lookahead += 1;

    const child = lines[lookahead];
    if (child === undefined || indentOf(child) <= indent) {
      map[key] = null;
      continue;
    }

    const childIndent = indentOf(child);

    if (child.trim().startsWith("- ") || child.trim() === "-") {
      const items: FrontmatterValue[] = [];
      index = lookahead;
      while (index < lines.length) {
        const item = lines[index] ?? "";
        if (isBlank(item)) {
          index += 1;
          continue;
        }
        if (indentOf(item) < childIndent || !item.trim().startsWith("-")) break;
        items.push(parseScalar(item.trim().replace(/^-\s*/, "")));
        index += 1;
      }
      map[key] = items;
      continue;
    }

    const nested = parseMap(lines, lookahead, childIndent);
    map[key] = nested.value;
    index = nested.next;
  }

  return { value: map, next: index };
}

export function parseFrontmatter(source: string): Frontmatter {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  if (!/^---[ \t]*\n/.test(normalized)) {
    return { data: {}, body: normalized };
  }

  const lines = normalized.split("\n");
  const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)[ \t]*$/.test(line));

  if (end === -1) {
    throw new CliError("Frontmatter opened with --- but never closed.", {
      exitCode: ExitCode.VALIDATION,
      hint: "Close the block with a line containing only ---",
    });
  }

  const { value } = parseMap(lines.slice(1, end), 0, 0);

  return { data: value, body: lines.slice(end + 1).join("\n") };
}

const asStringList = (value: FrontmatterValue, key: string): string[] => {
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.map((item) => asString(item, key));
  throw new CliError(`Frontmatter key "${key}" must be a string or a list.`, {
    exitCode: ExitCode.VALIDATION,
  });
};

const asString = (value: FrontmatterValue, key: string): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new CliError(`Frontmatter key "${key}" must be a string.`, {
    exitCode: ExitCode.VALIDATION,
  });
};

const asBoolean = (value: FrontmatterValue, key: string): boolean => {
  if (typeof value === "boolean") return value;
  throw new CliError(`Frontmatter key "${key}" must be true or false.`, {
    exitCode: ExitCode.VALIDATION,
  });
};

const asNumber = (value: FrontmatterValue, key: string): number => {
  if (typeof value === "number") return value;
  throw new CliError(`Frontmatter key "${key}" must be a number.`, {
    exitCode: ExitCode.VALIDATION,
  });
};

const asMap = (value: FrontmatterValue, key: string): FrontmatterMap => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
  throw new CliError(`Frontmatter key "${key}" must be a block of keys.`, {
    exitCode: ExitCode.VALIDATION,
  });
};

function platformKey(key: string): PlatformType | undefined {
  const lower = key.toLowerCase();
  const alias = PLATFORM_ALIASES[lower];
  if (alias) return alias;
  const upper = key.toUpperCase();
  return (PLATFORM_TYPES as readonly string[]).includes(upper) ? (upper as PlatformType) : undefined;
}

export function parsePostInput(source: string): PostInput {
  const { data, body } = parseFrontmatter(source);
  const input: PostInput = {};
  const text = body.trim();

  if (text !== "") input.text = text;

  for (const [rawKey, value] of Object.entries(data)) {
    if (value === null) continue;

    const target = SCALAR_KEYS.get(rawKey.toLowerCase());

    if (target === "text") {
      input.text = asString(value, rawKey);
      continue;
    }
    if (target === "platforms") {
      input.platforms = asStringList(value, rawKey).map(normalizePlatformName);
      continue;
    }
    if (target === "accounts") {
      input.accounts = [...(input.accounts ?? []), ...asStringList(value, rawKey)];
      continue;
    }
    if (target === "contentType") {
      input.contentType = normalizeContentType(asString(value, rawKey));
      continue;
    }
    if (target === "at") {
      input.at = asString(value, rawKey);
      continue;
    }
    if (target === "timezone") {
      input.timezone = asString(value, rawKey);
      continue;
    }
    if (target === "media") {
      input.media = asStringList(value, rawKey);
      continue;
    }
    if (target === "alt") {
      input.alt = Array.isArray(value) ? value.map((item) => asString(item, rawKey)) : [asString(value, rawKey)];
      continue;
    }
    if (target === "thumbnail") {
      input.thumbnail = asString(value, rawKey);
      continue;
    }
    if (target === "thumbnailMs") {
      input.thumbnailMs = asNumber(value, rawKey);
      continue;
    }
    if (target === "draft") {
      input.draft = asBoolean(value, rawKey);
      continue;
    }

    const platform = platformKey(rawKey);

    if (!platform) {
      throw new CliError(`Unknown frontmatter key "${rawKey}".`, {
        exitCode: ExitCode.VALIDATION,
        hint: `Known keys: ${[...new Set(SCALAR_KEYS.keys())].join(", ")}, or a platform name`,
      });
    }

    if (typeof value === "string") {
      input.platformTexts = { ...input.platformTexts, [platform]: value };
      continue;
    }

    const block = asMap(value, rawKey);
    const { text: platformText, ...config } = block;

    if (platformText !== undefined && platformText !== null) {
      input.platformTexts = {
        ...input.platformTexts,
        [platform]: asString(platformText, `${rawKey}.text`),
      };
    }

    if (Object.keys(config).length > 0) {
      input.platformConfigs = { ...input.platformConfigs, [platform]: config };
    }
  }

  return input;
}

export function mergePostInput(base: PostInput, override: PostInput): PostInput {
  const merged: PostInput = { ...base };

  for (const [key, value] of Object.entries(override) as [keyof PostInput, unknown][]) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    Object.assign(merged, { [key]: value });
  }

  if (base.platformTexts || override.platformTexts) {
    merged.platformTexts = { ...base.platformTexts, ...override.platformTexts };
  }

  if (base.platformConfigs || override.platformConfigs) {
    merged.platformConfigs = { ...base.platformConfigs };
    for (const [platform, config] of Object.entries(override.platformConfigs ?? {})) {
      merged.platformConfigs[platform as PlatformType] = {
        ...merged.platformConfigs[platform as PlatformType],
        ...config,
      };
    }
  }

  return merged;
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function readSource(path: string): Promise<string> {
  if (path === "-") {
    const source = await readStdin();
    if (source.trim() === "") {
      throw new CliError("Nothing arrived on stdin.", { exitCode: ExitCode.USAGE });
    }
    return source;
  }

  try {
    return await readFile(resolvePath(path), "utf8");
  } catch (error) {
    throw new CliError(`Cannot read ${path}: ${(error as Error).message}`, {
      exitCode: ExitCode.USAGE,
      cause: error,
    });
  }
}

export async function readPostInput(path: string): Promise<PostInput> {
  return parsePostInput(await readSource(path));
}

export function inferContentType(mediaCount: number, mimeTypes: string[]): ContentType {
  if (mediaCount === 0) return "TEXT";
  if (mediaCount > 1) return "CAROUSEL";
  return mimeTypes[0]?.startsWith("video/") ? "VIDEO" : "IMAGE";
}

export function isRemoteMedia(reference: string): boolean {
  return /^https?:\/\//i.test(reference);
}

const MIME_BY_SIGNATURE: { mime: UploadMimeType; test: (head: Buffer) => boolean }[] = [
  { mime: "image/jpeg", test: (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff },
  {
    mime: "image/png",
    test: (head) => head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/webp",
    test: (head) => head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP",
  },
  {
    mime: "video/quicktime",
    test: (head) =>
      head.subarray(4, 8).toString("ascii") === "ftyp" &&
      ["qt  ", "qt"].includes(head.subarray(8, 12).toString("ascii").trimEnd()),
  },
  {
    mime: "video/mp4",
    test: (head) => head.subarray(4, 8).toString("ascii") === "ftyp",
  },
];

export function sniffMimeType(head: Buffer): UploadMimeType | undefined {
  return MIME_BY_SIGNATURE.find((candidate) => candidate.test(head))?.mime;
}

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const UPLOAD_CHUNK = 20;

export interface LocalMedia {
  reference: string;
  path: string;
  fileName: string;
  mimeType: UploadMimeType;
  size: number;
  hash: string;
}

export async function inspectLocalMedia(reference: string): Promise<LocalMedia> {
  const path = resolvePath(reference);

  let size: number;
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      throw new CliError(`${reference} is not a file.`, { exitCode: ExitCode.USAGE });
    }
    size = stats.size;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`Media file not found: ${reference}`, {
      exitCode: ExitCode.USAGE,
      cause: error,
    });
  }

  const bytes = await readFile(path);
  const mimeType = sniffMimeType(bytes.subarray(0, 12));

  if (!mimeType) {
    throw new CliError(`${reference} is not a supported media file.`, {
      exitCode: ExitCode.VALIDATION,
      hint: "Supported: image/jpeg, image/png, image/webp, video/mp4, video/quicktime",
    });
  }

  const limit = mimeType.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  if (size > limit) {
    throw new CliError(
      `${reference} is ${formatBytes(size)}, over the ${formatBytes(limit)} limit for ${mimeType}.`,
      { exitCode: ExitCode.VALIDATION },
    );
  }

  return {
    reference,
    path,
    fileName: basename(path),
    mimeType,
    size,
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function putMedia(uploadUrl: string, media: LocalMedia): Promise<void> {
  const bytes = await readFile(media.path);

  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": media.mimeType },
      body: new Uint8Array(bytes),
    });
  } catch (error) {
    throw new CliError(`Upload of ${media.reference} failed: ${(error as Error).message}`, {
      exitCode: ExitCode.NETWORK,
      cause: error,
    });
  }

  if (!response.ok) {
    throw new CliError(
      `Upload of ${media.reference} was rejected with ${response.status} ${response.statusText}.`,
      { exitCode: ExitCode.GENERIC },
    );
  }
}

export interface UploadMediaOptions {
  concurrency?: number;
  onUploaded?: (media: LocalMedia, publicUrl: string) => void;
}

export async function uploadLocalMedia(
  references: string[],
  options: UploadMediaOptions = {},
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const locals = new Map<string, LocalMedia>();

  for (const reference of references) {
    if (isRemoteMedia(reference)) {
      urls.set(reference, reference);
      continue;
    }
    if (locals.has(reference)) continue;
    locals.set(reference, await inspectLocalMedia(reference));
  }

  const byHash = new Map<string, LocalMedia>();
  for (const media of locals.values()) {
    if (!byHash.has(media.hash)) byHash.set(media.hash, media);
  }

  const unique = [...byHash.values()];
  const publicByHash = new Map<string, string>();

  for (let start = 0; start < unique.length; start += UPLOAD_CHUNK) {
    const chunk = unique.slice(start, start + UPLOAD_CHUNK);
    const minted = await createUploadUrls({
      files: chunk.map((media) => ({ fileName: media.fileName, mimeType: media.mimeType })),
    });

    if (minted.urls.length !== chunk.length) {
      throw new CliError(
        `Asked for ${chunk.length} upload URLs and got ${minted.urls.length}.`,
        { exitCode: ExitCode.GENERIC },
      );
    }

    const concurrency = Math.max(1, options.concurrency ?? 4);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < chunk.length) {
        const index = cursor;
        cursor += 1;
        const media = chunk[index];
        const slot = minted.urls[index];
        if (!media || !slot) continue;
        await putMedia(slot.uploadUrl, media);
        publicByHash.set(media.hash, slot.publicUrl);
        options.onUploaded?.(media, slot.publicUrl);
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, chunk.length) }, worker));
  }

  for (const [reference, media] of locals) {
    const publicUrl = publicByHash.get(media.hash);
    if (publicUrl) urls.set(reference, publicUrl);
  }

  return urls;
}

export interface BuildPostBodyOptions {
  accounts: SocialAccount[];
  mediaUrls?: string[];
  requireTargets?: boolean;
  requireContent?: boolean;
}

interface TargetRouting {
  targets: PostTargets;
  platforms: PlatformType[];
  connectionsByPlatform: Map<PlatformType, string[]>;
}

function routeAccounts(
  ids: string[],
  platforms: PlatformType[],
  accounts: SocialAccount[],
): TargetRouting {
  const targets: PostTargets = {};
  const connectionsByPlatform = new Map<PlatformType, string[]>();
  const resolved = [...platforms];

  for (const id of ids) {
    const account = accounts.find(
      (candidate) => candidate.id === id || candidate.pageId === id,
    );

    if (!account) {
      throw new CliError(`No connected account with id "${id}" in this workspace.`, {
        exitCode: ExitCode.NOT_FOUND,
        hint: "List them with: adaptlypost accounts list",
      });
    }

    if (!resolved.includes(account.platform)) resolved.push(account.platform);

    const field = CONNECTION_FIELD[account.platform];
    const existing = (targets[field] as string[] | undefined) ?? [];
    if (!existing.includes(account.id)) existing.push(account.id);
    Object.assign(targets, { [field]: existing });

    const known = connectionsByPlatform.get(account.platform) ?? [];
    if (!known.includes(account.id)) known.push(account.id);
    connectionsByPlatform.set(account.platform, known);
  }

  return { targets, platforms: resolved, connectionsByPlatform };
}

function buildConfigs(
  input: PostInput,
  routing: TargetRouting,
): PostTargets {
  const configs: PostTargets = {};

  for (const [rawPlatform, config] of Object.entries(input.platformConfigs ?? {})) {
    const platform = rawPlatform as PlatformType;
    const field = CONFIG_FIELD[platform];

    if (!field) {
      throw new CliError(`${platform} has no per-platform config.`, {
        exitCode: ExitCode.VALIDATION,
        hint: `Configs exist for: ${Object.keys(CONFIG_FIELD).join(", ")}`,
      });
    }

    const connections = routing.connectionsByPlatform.get(platform) ?? [];

    if (connections.length === 0) {
      throw new CliError(`A ${platform} config needs a ${platform} account.`, {
        exitCode: ExitCode.VALIDATION,
        hint: `Add one with --account <id>`,
      });
    }

    const entries = connections.map((connectionId) =>
      platform === "FACEBOOK"
        ? ({ pageId: connectionId, ...config } as unknown as FacebookPostConfig)
        : ({ connectionId, ...config } as unknown as
            | TikTokPostConfig
            | InstagramPostConfig
            | PinterestPostConfig
            | YouTubePostConfig),
    );

    Object.assign(configs, { [field]: entries });
  }

  return configs;
}

function validateRequiredConfigs(body: CreatePostRequest | UpdatePostRequest): void {
  const platforms = body.platforms ?? [];

  if (platforms.includes("TIKTOK")) {
    const missing = (body.tiktokConfigs ?? []).some((config) => !config.privacyLevel);
    if ((body.tiktokConfigs ?? []).length === 0 || missing) {
      throw new CliError("TikTok needs a privacy level.", {
        exitCode: ExitCode.VALIDATION,
        hint: "Add --tiktok-privacy PUBLIC_TO_EVERYONE (or SELF_ONLY, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR)",
      });
    }
  }

  if (platforms.includes("PINTEREST")) {
    const missing = (body.pinterestConfigs ?? []).some((config) => !config.boardId);
    if ((body.pinterestConfigs ?? []).length === 0 || missing) {
      throw new CliError("Pinterest needs a board id.", {
        exitCode: ExitCode.VALIDATION,
        hint: "Add --pinterest-board <boardId>",
      });
    }
  }
}

export function buildTargets(
  input: PostInput,
  accounts: SocialAccount[],
): { platforms: PlatformType[]; targets: PostTargets } {
  const routing = routeAccounts(input.accounts ?? [], input.platforms ?? [], accounts);

  return {
    platforms: routing.platforms,
    targets: { ...routing.targets, ...buildConfigs(input, routing) },
  };
}

export function buildPostBody(
  input: PostInput,
  options: BuildPostBodyOptions,
): CreatePostRequest {
  const routing = routeAccounts(input.accounts ?? [], input.platforms ?? [], options.accounts);

  if (options.requireTargets !== false && routing.platforms.length === 0) {
    throw new CliError("No platform to post to.", {
      exitCode: ExitCode.USAGE,
      hint: "Pass --platform TWITTER (repeatable) or set defaultPlatforms in config",
    });
  }

  const mediaUrls = options.mediaUrls ?? input.media ?? [];
  const contentType =
    input.contentType ??
    inferContentType(
      mediaUrls.length,
      mediaUrls.map((url) => (/\.(mp4|mov|m4v|qt)(\?|$)/i.test(url) ? "video/mp4" : "image/jpeg")),
    );

  const platformTexts: PlatformText[] = Object.entries(input.platformTexts ?? {}).map(
    ([platform, text]) => ({ platform: platform as PlatformType, text }),
  );

  const body: CreatePostRequest = {
    platforms: routing.platforms,
    contentType,
    timezone: input.timezone ?? "UTC",
    ...routing.targets,
    ...buildConfigs(input, routing),
  };

  if (input.text !== undefined) body.text = input.text;
  if (input.at !== undefined) body.scheduledAt = input.at;
  if (input.draft) body.saveAsDraft = true;
  if (mediaUrls.length > 0) body.mediaUrls = mediaUrls;
  if (mediaUrls.length > 0 && input.alt?.length) body.mediaAltTexts = input.alt;
  if (input.thumbnail !== undefined) body.thumbnailUrl = input.thumbnail;
  if (input.thumbnailMs !== undefined) body.thumbnailTimestampMs = input.thumbnailMs;
  if (platformTexts.length > 0) body.platformTexts = platformTexts;

  if (options.requireContent !== false && !body.text && mediaUrls.length === 0) {
    throw new CliError("A post needs text or media.", {
      exitCode: ExitCode.VALIDATION,
      hint: "Pass --text, --file, or --media",
    });
  }

  if (!input.draft) validateRequiredConfigs(body);

  return body;
}
