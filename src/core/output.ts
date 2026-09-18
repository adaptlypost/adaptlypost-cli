import { dim, green, red, yellow } from "./color.js";
import { exitCodeFor, hintFor, toErrorPayload } from "./errors.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { DEFAULT_TABLE_WIDTH, renderRows, renderTable, type Column, type TableOptions } from "./table.js";

export type OutputMode = "human" | "machine";

export interface OutputModeInput {
  json?: boolean;
  envPrefix?: string;
  env?: Record<string, string | undefined>;
  isTTY?: boolean;
}

export interface InitOutputInput extends OutputModeInput {
  quiet?: boolean;
  fullIds?: boolean;
  command?: string;
}

export interface RateLimitMeta {
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface ResultMeta {
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  rateLimit?: RateLimitMeta | null;
  [key: string]: unknown;
}

const ID_PREFIX_LENGTH = 12;

let mode: OutputMode = "human";
let quiet = false;
let fullIds = false;
let commandName = "";

export function detectOutputMode(input: OutputModeInput = {}): OutputMode {
  const env = input.env ?? process.env;
  const prefix = input.envPrefix;
  if (input.json === true) return "machine";
  if (prefix !== undefined && isTruthy(env[`${prefix}_JSON`])) return "machine";
  if (prefix !== undefined && isTruthy(env[`${prefix}_FORCE_TTY`])) return "human";
  if (isTruthy(env.FORCE_TTY)) return "human";
  if (isTruthy(env.CI)) return "machine";
  const tty = input.isTTY ?? Boolean(process.stdout.isTTY);
  return tty ? "human" : "machine";
}

export function initOutput(input: InitOutputInput = {}): OutputMode {
  mode = detectOutputMode(input);
  quiet = input.quiet === true;
  fullIds = input.fullIds === true;
  if (input.command !== undefined) commandName = input.command;
  return mode;
}

export function setOutputMode(next: OutputMode): void {
  mode = next;
}

export function getOutputMode(): OutputMode {
  return mode;
}

export function isMachine(): boolean {
  return mode === "machine";
}

export function isHuman(): boolean {
  return mode === "human";
}

export function setQuiet(value: boolean): void {
  quiet = value;
}

export function isQuiet(): boolean {
  return quiet;
}

export function setFullIds(value: boolean): void {
  fullIds = value;
}

export function getFullIds(): boolean {
  return fullIds;
}

export function setCommandName(name: string): void {
  commandName = name;
}

export function getCommandName(): string {
  return commandName;
}

export function terminalWidth(): number {
  const columns = process.stdout.columns;
  return typeof columns === "number" && columns > 0 ? columns : DEFAULT_TABLE_WIDTH;
}

export function print(text = ""): void {
  if (mode !== "human") return;
  writeOut(`${text}\n`);
}

export function printLines(lines: readonly string[]): void {
  if (mode !== "human") return;
  if (lines.length === 0) return;
  writeOut(`${lines.join("\n")}\n`);
}

export function printTable<T>(
  rows: readonly T[],
  columns: readonly Column<T>[],
  options: TableOptions = {},
): void {
  if (mode !== "human") return;
  if (rows.length === 0) return;
  const rendered = renderTable(rows, columns, { ...options, width: options.width ?? terminalWidth() });
  if (rendered !== "") writeOut(`${rendered}\n`);
}

export function printRows(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  options: TableOptions = {},
): void {
  if (mode !== "human") return;
  if (rows.length === 0) return;
  const rendered = renderRows(headers, rows, { ...options, width: options.width ?? terminalWidth() });
  if (rendered !== "") writeOut(`${rendered}\n`);
}

export function printKeyValues(entries: readonly (readonly [string, string])[], indent = "  "): void {
  if (mode !== "human") return;
  if (entries.length === 0) return;
  const width = entries.reduce((max, [key]) => Math.max(max, key.length), 0);
  const lines = entries.map(([key, value]) => `${indent}${key.padEnd(width)}  ${value}`);
  writeOut(`${lines.join("\n")}\n`);
}

export function printJson(value: unknown): void {
  writeOut(`${JSON.stringify(value, null, 2)}\n`);
}

export function printResult(command: string, data: unknown, meta?: ResultMeta): void {
  if (mode !== "machine") return;
  commandName = command;
  const payload: Record<string, unknown> = {
    ok: true,
    command,
    data: data === undefined ? null : data,
  };
  if (meta !== undefined) payload.meta = meta;
  printJson(payload);
}

export function printFieldHints(data: unknown): void {
  if (quiet) return;
  const sample = Array.isArray(data) ? data[0] : data;
  if (typeof sample !== "object" || sample === null) return;
  const fields = Object.keys(sample as Record<string, unknown>);
  if (fields.length === 0) return;
  writeErr(`${dim(`fields: ${fields.join(" ")}`)}\n`);
}

export function hint(text: string): void {
  if (quiet) return;
  writeErr(`${dim(text)}\n`);
}

export function warn(text: string): void {
  if (quiet) return;
  writeErr(`${yellow("⚠")} ${text}\n`);
}

export function success(text: string): void {
  if (mode !== "human") return;
  writeOut(`${green("✓")} ${text}\n`);
}

export function failure(text: string): void {
  if (mode !== "human") return;
  writeOut(`${red("✗")} ${text}\n`);
}

export function printError(error: unknown, command = commandName): ExitCodeValue {
  const exitCode = exitCodeFor(error);
  const payload = toErrorPayload(error);

  if (mode === "machine") {
    writeErr(`${JSON.stringify({ ok: false, command: command || "unknown", error: payload }, null, 2)}\n`);
    return exitCode;
  }

  writeErr(`${red("✗")} ${payload.message}\n`);
  const details = Array.isArray(payload.details) ? payload.details : null;
  if (details !== null && details.length > 1) {
    for (const detail of details) {
      writeErr(`  ${dim("·")} ${detail}\n`);
    }
  }
  const text = hintFor(error);
  if (text !== undefined && text.trim() !== "") {
    writeErr("\n");
    for (const line of text.split("\n")) {
      writeErr(`  ${line}\n`);
    }
  }
  const requestId = typeof (error as { requestId?: unknown })?.requestId === "string"
    ? (error as { requestId: string }).requestId
    : undefined;
  if (requestId !== undefined) {
    writeErr(`\n  ${dim(`request id: ${requestId}`)}\n`);
  }
  return exitCode;
}

export function formatId(id: string, prefixLength = ID_PREFIX_LENGTH): string {
  if (fullIds || mode === "machine") return id;
  if (id.length <= prefixLength) return id;
  return `${id.slice(0, prefixLength)}…`;
}

export function exitWith(code: ExitCodeValue = ExitCode.OK): never {
  process.exit(code);
}

function writeOut(chunk: string): void {
  process.stdout.write(chunk);
}

function writeErr(chunk: string): void {
  process.stderr.write(chunk);
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  const normalized = value.toLowerCase();
  return normalized !== "0" && normalized !== "false";
}
