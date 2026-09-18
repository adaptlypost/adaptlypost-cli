import { usageError } from "./errors.js";

export interface ParseWhenOptions {
  now?: Date;
  timezone?: string;
}

export interface FormatAbsoluteOptions {
  timezone?: string;
  seconds?: boolean;
  withZone?: boolean;
}

export interface FormatRelativeOptions {
  now?: Date;
}

export interface FormatTimestampOptions extends FormatAbsoluteOptions, FormatRelativeOptions {}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  milliseconds: 1,
  s: SECOND,
  sec: SECOND,
  secs: SECOND,
  second: SECOND,
  seconds: SECOND,
  m: MINUTE,
  min: MINUTE,
  mins: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,
  h: HOUR,
  hr: HOUR,
  hrs: HOUR,
  hour: HOUR,
  hours: HOUR,
  d: DAY,
  day: DAY,
  days: DAY,
  w: WEEK,
  week: WEEK,
  weeks: WEEK,
};

const DURATION_PART = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
const ISO_ZONED = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DAY_KEYWORD = /^(today|tomorrow|yesterday)(?:\s+(.+))?$/;

export function isValidTimeZone(timezone: string): boolean {
  if (typeof timezone !== "string" || timezone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function assertTimeZone(timezone: string): string {
  if (!isValidTimeZone(timezone)) {
    throw usageError(
      `"${timezone}" is not a valid IANA time zone.`,
      'Use a zone name such as "Europe/Berlin" or "UTC".',
    );
  }
  return timezone;
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (text === "") return null;
  const sign = text.startsWith("-") ? -1 : 1;
  const body = (text.startsWith("+") || text.startsWith("-") ? text.slice(1) : text).replace(/\s+/g, "");
  if (body === "") return null;

  DURATION_PART.lastIndex = 0;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = DURATION_PART.exec(body)) !== null) {
    const unit = UNIT_MS[match[2]];
    if (unit === undefined) return null;
    total += Number(match[1]) * unit;
    consumed += match[0].length;
  }
  if (consumed === 0 || consumed !== body.length) return null;
  return sign * total;
}

export function parseIso(input: string): Date | null {
  const text = input.trim();
  if (text === "") return null;
  if (!ISO_ZONED.test(text) && !LOCAL_DATE_TIME.test(text)) return null;
  const date = new Date(ISO_ZONED.test(text) ? text.replace(" ", "T") : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseWhen(input: string, options: ParseWhenOptions = {}): Date {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? "UTC";
  const text = input.trim();
  if (text === "") throw whenError(input);

  const lower = text.toLowerCase();
  if (lower === "now") return new Date(now.getTime());

  if (ISO_ZONED.test(text)) {
    const date = new Date(text.replace(" ", "T"));
    if (Number.isNaN(date.getTime())) throw whenError(input);
    return date;
  }

  if (text.startsWith("+") || text.startsWith("-")) {
    const offset = parseDuration(text);
    if (offset === null) throw whenError(input);
    return new Date(now.getTime() + offset);
  }

  const keyword = DAY_KEYWORD.exec(lower);
  if (keyword !== null) {
    const shift = keyword[1] === "tomorrow" ? 1 : keyword[1] === "yesterday" ? -1 : 0;
    const clock = parseClock(keyword[2]);
    if (clock === null) throw whenError(input);
    const base = wallClockOf(now, timezone);
    const shifted = shiftDays(base, shift);
    return fromWallClock({ ...shifted, ...clock }, timezone);
  }

  const local = LOCAL_DATE_TIME.exec(text);
  if (local !== null) {
    return fromWallClock(
      {
        year: Number(local[1]),
        month: Number(local[2]),
        day: Number(local[3]),
        hour: local[4] === undefined ? 0 : Number(local[4]),
        minute: local[5] === undefined ? 0 : Number(local[5]),
        second: local[6] === undefined ? 0 : Number(local[6]),
      },
      timezone,
    );
  }

  if (/^\d/.test(lower)) {
    const offset = parseDuration(lower);
    if (offset !== null) return new Date(now.getTime() + offset);
  }

  throw whenError(input);
}

export function toIso(date: Date): string {
  return date.toISOString();
}

export function formatAbsolute(date: Date, options: FormatAbsoluteOptions = {}): string {
  const timezone = options.timezone ?? "UTC";
  const clock = wallClockOf(date, timezone);
  const base =
    `${pad(clock.year, 4)}-${pad(clock.month, 2)}-${pad(clock.day, 2)} ` +
    `${pad(clock.hour, 2)}:${pad(clock.minute, 2)}` +
    (options.seconds === true ? `:${pad(clock.second, 2)}` : "");
  return options.withZone === false ? base : `${base} ${timezone}`;
}

export function formatDate(date: Date, timezone = "UTC"): string {
  const clock = wallClockOf(date, timezone);
  return `${pad(clock.year, 4)}-${pad(clock.month, 2)}-${pad(clock.day, 2)}`;
}

export function formatRelative(date: Date, options: FormatRelativeOptions = {}): string {
  const now = options.now ?? new Date();
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < SECOND) return "now";

  const value = relativeUnit(abs);
  return diff < 0 ? `${value} ago` : `in ${value}`;
}

export function formatTimestamp(date: Date, options: FormatTimestampOptions = {}): string {
  return `${formatAbsolute(date, options)} (${formatRelative(date, options)})`;
}

export function formatDuration(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(Math.round(ms));
  if (abs < SECOND) return `${sign}${abs}ms`;
  if (abs < MINUTE) return `${sign}${Math.round(abs / SECOND)}s`;
  if (abs < HOUR) return `${sign}${join(Math.floor(abs / MINUTE), "m", Math.round((abs % MINUTE) / SECOND), "s")}`;
  if (abs < DAY) return `${sign}${join(Math.floor(abs / HOUR), "h", Math.round((abs % HOUR) / MINUTE), "m")}`;
  return `${sign}${join(Math.floor(abs / DAY), "d", Math.round((abs % DAY) / HOUR), "h")}`;
}

function relativeUnit(abs: number): string {
  if (abs < MINUTE) return `${Math.max(1, Math.floor(abs / SECOND))}s`;
  if (abs < HOUR) return `${Math.floor(abs / MINUTE)}m`;
  if (abs < DAY) return `${Math.floor(abs / HOUR)}h`;
  if (abs < 30 * DAY) return `${Math.floor(abs / DAY)}d`;
  if (abs < 365 * DAY) return `${Math.floor(abs / (30 * DAY))}mo`;
  return `${Math.floor(abs / (365 * DAY))}y`;
}

function join(major: number, majorUnit: string, minor: number, minorUnit: string): string {
  return minor === 0 ? `${major}${majorUnit}` : `${major}${majorUnit} ${minor}${minorUnit}`;
}

function parseClock(text: string | undefined): Pick<WallClock, "hour" | "minute" | "second"> | null {
  if (text === undefined || text.trim() === "") return { hour: 0, minute: 0, second: 0 };
  const match = CLOCK.exec(text.trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function wallClockOf(date: Date, timezone: string): WallClock {
  const parts = zoneFormatter(timezone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

function shiftDays(clock: WallClock, days: number): WallClock {
  const shifted = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: clock.hour,
    minute: clock.minute,
    second: clock.second,
  };
}

function fromWallClock(clock: WallClock, timezone: string): Date {
  assertTimeZone(timezone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  let timestamp = asUtc - zoneOffset(new Date(asUtc), timezone);
  timestamp = asUtc - zoneOffset(new Date(timestamp), timezone);
  return new Date(timestamp);
}

function zoneOffset(date: Date, timezone: string): number {
  const clock = wallClockOf(date, timezone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timezone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timezone, formatter);
  return formatter;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function whenError(input: string): Error {
  return usageError(
    `Could not read "${input}" as a date.`,
    'Use ISO 8601 (2026-09-20T09:00:00Z), an offset (+2h), a duration (30m), or "tomorrow 09:00".',
  );
}
