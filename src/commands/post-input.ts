import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";

import { createUploadUrls } from "../api/client.js";
import {
  CONTENT_TYPES,
  PLATFORM_TYPES,
  RECURRENCE_FREQUENCIES,
  WEEKDAYS,
  type ContentType,
  type CreatePostRequest,
  type PlatformText,
  type PlatformType,
  type PostTargets,
  type Recurrence,
  type RecurrenceFrequency,
  type SocialAccount,
  type UpdatePostRequest,
  type UploadMimeType,
  type Weekday,
} from "../api/types.js";
import { CliError, ExitCode, formatDate, type ExitCodeValue } from "../core/index.js";
import {
  SNIFF_BYTES,
  guessMimeType,
  isDocumentMimeType,
  isImageOrVideoReference,
  maxBytesFor,
  sniffMimeType,
  unsupportedMediaHint,
  uploadFileName,
} from "./media-kind.js";

export { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, sniffMimeType } from "./media-kind.js";

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

export interface RecurrenceInput {
  frequency?: RecurrenceFrequency;
  interval?: number;
  weekdays?: Weekday[];
  endsOn?: string;
  maxOccurrences?: number;
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
  recurrence?: RecurrenceInput;
}

export const CONNECTION_FIELD: Record<PlatformType, keyof PostTargets> = {
  FACEBOOK: "pageIds",
  INSTAGRAM: "instagramConnectionIds",
  THREADS: "threadsConnectionIds",
  TIKTOK: "tiktokConnectionIds",
  TWITTER: "twitterConnectionIds",
  BLUESKY: "blueskyConnectionIds",
  MASTODON: "mastodonConnectionIds",
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
  LINKEDIN: "linkedinConfigs",
};

export const MAX_DOCUMENT_TITLE_LENGTH = 100;
export const RECURRENCE_MAX_INTERVAL = 30;
export const RECURRENCE_MIN_OCCURRENCES = 2;
export const RECURRENCE_MAX_OCCURRENCES = 365;

const PLATFORM_ALIASES: Record<string, PlatformType> = {
  x: "TWITTER",
  fb: "FACEBOOK",
  ig: "INSTAGRAM",
  li: "LINKEDIN",
  yt: "YOUTUBE",
  tt: "TIKTOK",
};

const SCALAR_KEYS = new Map<string, keyof PostInput | keyof RecurrenceInput | "documentTitle">([
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
  ["documenttitle", "documentTitle"],
  ["document-title", "documentTitle"],
  ["document_title", "documentTitle"],
  ["linkedindocumenttitle", "documentTitle"],
  ["repeat", "frequency"],
  ["frequency", "frequency"],
  ["every", "interval"],
  ["interval", "interval"],
  ["on", "weekdays"],
  ["weekdays", "weekdays"],
  ["until", "endsOn"],
  ["endson", "endsOn"],
  ["count", "maxOccurrences"],
  ["maxoccurrences", "maxOccurrences"],
]);

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
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

export function normalizeFrequency(value: string): RecurrenceFrequency {
  const frequency = value.trim().toUpperCase() as RecurrenceFrequency;

  if (!(RECURRENCE_FREQUENCIES as readonly string[]).includes(frequency)) {
    throw new CliError(
      `Unknown repeat frequency "${value}". Expected one of: ${RECURRENCE_FREQUENCIES.join(", ")}.`,
      { exitCode: ExitCode.USAGE },
    );
  }

  return frequency;
}

export function normalizeWeekday(value: string): Weekday {
  const raw = value.trim().toUpperCase();
  const weekday = WEEKDAYS.find((day) => day === raw || (raw.length === 3 && day.startsWith(raw)));

  if (!weekday) {
    throw new CliError(
      `Unknown weekday "${value}". Expected one of: ${WEEKDAYS.join(", ")}, or their first three letters.`,
      { exitCode: ExitCode.USAGE },
    );
  }

  return weekday;
}

export function assertWholeNumberInRange(
  value: number,
  label: string,
  min: number,
  max: number,
  exitCode: ExitCodeValue,
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CliError(`${label} must be a whole number from ${min} to ${max}.`, { exitCode });
  }
  return value;
}

export function assertCalendarDate(value: string, label: string, exitCode: ExitCodeValue): string {
  const match = CALENDAR_DATE.exec(value.trim());
  const [, year, month, day] = match ?? [];
  const date = match ? new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))) : undefined;

  if (!date || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    throw new CliError(`${label} must be a date written as YYYY-MM-DD, got "${value}".`, { exitCode });
  }

  return value.trim();
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

const asWeekdays = (value: FrontmatterValue, key: string): Weekday[] => {
  const items = Array.isArray(value) ? value.map((item) => asString(item, key)) : [asString(value, key)];

  return items.map((item) => {
    if (item.includes(",")) {
      throw new CliError(`Frontmatter key "${key}" takes one weekday per list item, got "${item}".`, {
        exitCode: ExitCode.VALIDATION,
        hint: `Write a YAML list: ${key}: [MONDAY, THURSDAY]`,
      });
    }
    return normalizeWeekday(item);
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
    if (target === "frequency") {
      input.recurrence = { ...input.recurrence, frequency: normalizeFrequency(asString(value, rawKey)) };
      continue;
    }
    if (target === "interval") {
      input.recurrence = {
        ...input.recurrence,
        interval: assertWholeNumberInRange(
          asNumber(value, rawKey),
          `Frontmatter key "${rawKey}"`,
          1,
          RECURRENCE_MAX_INTERVAL,
          ExitCode.VALIDATION,
        ),
      };
      continue;
    }
    if (target === "weekdays") {
      input.recurrence = { ...input.recurrence, weekdays: asWeekdays(value, rawKey) };
      continue;
    }
    if (target === "endsOn") {
      input.recurrence = {
        ...input.recurrence,
        endsOn: assertCalendarDate(asString(value, rawKey), `Frontmatter key "${rawKey}"`, ExitCode.VALIDATION),
      };
      continue;
    }
    if (target === "maxOccurrences") {
      input.recurrence = {
        ...input.recurrence,
        maxOccurrences: assertWholeNumberInRange(
          asNumber(value, rawKey),
          `Frontmatter key "${rawKey}"`,
          RECURRENCE_MIN_OCCURRENCES,
          RECURRENCE_MAX_OCCURRENCES,
          ExitCode.VALIDATION,
        ),
      };
      continue;
    }
    if (target === "documentTitle") {
      input.platformConfigs = {
        ...input.platformConfigs,
        LINKEDIN: { ...input.platformConfigs?.LINKEDIN, documentTitle: asString(value, rawKey) },
      };
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
      input.platformConfigs = {
        ...input.platformConfigs,
        [platform]: { ...input.platformConfigs?.[platform], ...config },
      };
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

  if (base.recurrence || override.recurrence) {
    const overridesEnd =
      override.recurrence?.endsOn !== undefined || override.recurrence?.maxOccurrences !== undefined;
    merged.recurrence = {
      ...base.recurrence,
      ...(overridesEnd ? { endsOn: undefined, maxOccurrences: undefined } : {}),
      ...override.recurrence,
    };
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
  if (mimeTypes.some(isDocumentMimeType)) return "DOCUMENT";
  if (mediaCount > 1) return "CAROUSEL";
  return mimeTypes[0]?.startsWith("video/") ? "VIDEO" : "IMAGE";
}

export function inferContentTypeFromReferences(references: string[]): ContentType {
  return inferContentType(references.length, references.map(guessMimeType));
}

export function isRemoteMedia(reference: string): boolean {
  return /^https?:\/\//i.test(reference);
}

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
  const head = bytes.subarray(0, SNIFF_BYTES);
  const mimeType = sniffMimeType(head, path);

  if (!mimeType) {
    throw new CliError(`${reference} is not a supported media file.`, {
      exitCode: ExitCode.VALIDATION,
      hint: unsupportedMediaHint(head),
    });
  }

  const limit = maxBytesFor(mimeType);

  if (size > limit) {
    throw new CliError(
      `${reference} is ${formatBytes(size)}, over the ${formatBytes(limit)} limit for ${mimeType}.`,
      { exitCode: ExitCode.VALIDATION },
    );
  }

  return {
    reference,
    path,
    fileName: uploadFileName(basename(path), mimeType),
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

    const documentTitle = platform === "LINKEDIN" ? config.documentTitle : undefined;
    if (
      documentTitle !== undefined &&
      documentTitle !== null &&
      String(documentTitle).length > MAX_DOCUMENT_TITLE_LENGTH
    ) {
      throw new CliError(
        `The LinkedIn document title is ${String(documentTitle).length} characters; the limit is ${MAX_DOCUMENT_TITLE_LENGTH}.`,
        { exitCode: ExitCode.VALIDATION },
      );
    }

    const connections = routing.connectionsByPlatform.get(platform) ?? [];

    if (connections.length === 0) {
      throw new CliError(`A ${platform} config needs a ${platform} account.`, {
        exitCode: ExitCode.VALIDATION,
        hint: `Add one with --account <id>`,
      });
    }

    const entries = connections.map((connectionId) =>
      platform === "FACEBOOK" ? { pageId: connectionId, ...config } : { connectionId, ...config },
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

const DOCUMENT_FILE_MESSAGE = "A document post needs exactly one PDF, PPT, PPTX, DOC or DOCX file in mediaUrls";

/** Catches the API's DOCUMENT 400s before the request is sent. */
export function validateDocumentPost(
  body: CreatePostRequest | UpdatePostRequest,
  checkMedia = true,
): void {
  const mediaUrls = body.mediaUrls ?? [];
  const documents = mediaUrls.filter((url) => isDocumentMimeType(guessMimeType(url)));

  if (body.contentType !== "DOCUMENT") {
    if (documents.length > 0) {
      throw new CliError("Document files can only be posted with the DOCUMENT content type.", {
        exitCode: ExitCode.VALIDATION,
        hint: "Pass --type DOCUMENT and post to LinkedIn only",
      });
    }
    return;
  }

  const other = (body.platforms ?? []).find((platform) => platform !== "LINKEDIN");
  if (other) {
    throw new CliError(`${other} does not support DOCUMENT posts.`, {
      exitCode: ExitCode.VALIDATION,
      hint: "DOCUMENT is LinkedIn only; post the file to LINKEDIN alone",
    });
  }

  if (checkMedia && (mediaUrls.length !== 1 || isImageOrVideoReference(mediaUrls[0] ?? ""))) {
    throw new CliError(`${DOCUMENT_FILE_MESSAGE}.`, { exitCode: ExitCode.VALIDATION });
  }
}

function buildRecurrence(input: PostInput, body: CreatePostRequest): Recurrence | undefined {
  const recurrence = input.recurrence;
  if (!recurrence || Object.values(recurrence).every((value) => value === undefined)) return undefined;

  if (!recurrence.frequency) {
    throw new CliError("Choose how often the post repeats.", {
      exitCode: ExitCode.USAGE,
      hint: "Pass --repeat DAILY, WEEKLY or MONTHLY, or set repeat: in the frontmatter",
    });
  }

  if (body.saveAsDraft) {
    throw new CliError("A recurring post cannot be saved as a draft. Schedule it instead.", {
      exitCode: ExitCode.VALIDATION,
    });
  }

  if (!body.scheduledAt) {
    throw new CliError("Pick a future date and time for the first post of a recurring series.", {
      exitCode: ExitCode.USAGE,
      hint: 'Pass --at, for example --at "tomorrow 09:00". The first post sets the time of day',
    });
  }

  if (recurrence.endsOn !== undefined && recurrence.maxOccurrences !== undefined) {
    throw new CliError("Choose either an end date or a number of posts, not both.", {
      exitCode: ExitCode.VALIDATION,
    });
  }

  if (recurrence.weekdays?.length && recurrence.frequency !== "WEEKLY") {
    throw new CliError("Weekdays only apply to a weekly repeat.", {
      exitCode: ExitCode.VALIDATION,
      hint: "Pass --repeat WEEKLY, or drop --on",
    });
  }

  if (body.platforms.includes("TIKTOK")) {
    throw new CliError("TIKTOK posts cannot repeat. Remove the account or turn off repeat.", {
      exitCode: ExitCode.VALIDATION,
    });
  }

  if (
    recurrence.endsOn !== undefined &&
    recurrence.endsOn < formatDate(new Date(body.scheduledAt), body.timezone)
  ) {
    throw new CliError("The end date must be on or after the first post.", {
      exitCode: ExitCode.VALIDATION,
    });
  }

  const built: Recurrence = { frequency: recurrence.frequency };
  if (recurrence.interval !== undefined) built.interval = recurrence.interval;
  if (recurrence.weekdays?.length) built.weekdays = [...new Set(recurrence.weekdays)];
  if (recurrence.endsOn !== undefined) built.endsOn = recurrence.endsOn;
  if (recurrence.maxOccurrences !== undefined) built.maxOccurrences = recurrence.maxOccurrences;

  return built;
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
  const contentType = input.contentType ?? inferContentTypeFromReferences(mediaUrls);

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

  validateDocumentPost(body, options.requireContent !== false || mediaUrls.length > 0);

  const recurrence = buildRecurrence(input, body);
  if (recurrence) body.recurrence = recurrence;

  if (!input.draft) validateRequiredConfigs(body);

  return body;
}
