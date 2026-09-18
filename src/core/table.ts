import { dim, stripAnsi } from "./color.js";

export type Align = "left" | "right";

export interface Column<T> {
  header: string;
  value: (row: T, index: number) => string | number | null | undefined;
  align?: Align;
}

export interface TableOptions {
  width?: number;
  gap?: number;
  header?: boolean;
  align?: Align[];
}

export const DEFAULT_TABLE_WIDTH = 100;

const DEFAULT_GAP = 2;
const MIN_COLUMN_WIDTH = 3;
const NUMERIC = /^[-+]?[$€£]?\d[\d,]*(\.\d+)?%?$/;

export function displayWidth(value: string): number {
  return stripAnsi(value).length;
}

export function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  const plain = stripAnsi(value);
  if (plain.length <= max) return value;
  if (max === 1) return "…";
  return `${plain.slice(0, max - 1)}…`;
}

export function renderTable<T>(
  rows: readonly T[],
  columns: readonly Column<T>[],
  options: TableOptions = {},
): string {
  const cells = rows.map((row, index) => columns.map((column) => toCell(column.value(row, index))));
  const align = columns.map((column, index) =>
    column.align ?? inferAlign(cells.map((cellRow) => cellRow[index] ?? "")),
  );
  return renderRows(
    columns.map((column) => column.header),
    cells,
    { ...options, align },
  );
}

export function renderRows(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  options: TableOptions = {},
): string {
  if (rows.length === 0) return "";

  const gap = options.gap ?? DEFAULT_GAP;
  const totalWidth = options.width ?? DEFAULT_TABLE_WIDTH;
  const showHeader = options.header !== false;
  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length));
  if (columnCount === 0) return "";

  const titles = Array.from({ length: columnCount }, (_, i) => (headers[i] ?? "").toUpperCase());
  const align = Array.from(
    { length: columnCount },
    (_, i) => options.align?.[i] ?? inferAlign(rows.map((row) => row[i] ?? "")),
  );

  const widths = Array.from({ length: columnCount }, (_, i) => {
    const headerWidth = showHeader ? displayWidth(titles[i]) : 0;
    return rows.reduce((max, row) => Math.max(max, displayWidth(row[i] ?? "")), headerWidth);
  });

  fitWidths(widths, totalWidth, gap);

  const lines: string[] = [];
  if (showHeader) {
    lines.push(dim(joinCells(titles, widths, align, gap)));
  }
  for (const row of rows) {
    const values = Array.from({ length: columnCount }, (_, i) => row[i] ?? "");
    lines.push(joinCells(values, widths, align, gap));
  }
  return lines.join("\n");
}

function fitWidths(widths: number[], totalWidth: number, gap: number): void {
  const gaps = gap * Math.max(0, widths.length - 1);
  let overflow = widths.reduce((sum, width) => sum + width, 0) + gaps - totalWidth;
  if (overflow <= 0) return;

  for (let i = widths.length - 1; i >= 0 && overflow > 0; i -= 1) {
    const floor = Math.min(widths[i], MIN_COLUMN_WIDTH);
    const reducible = widths[i] - floor;
    const cut = Math.min(reducible, overflow);
    widths[i] -= cut;
    overflow -= cut;
  }
}

function joinCells(values: readonly string[], widths: readonly number[], align: readonly Align[], gap: number): string {
  const parts = values.map((value, i) => pad(truncate(value, widths[i]), widths[i], align[i]));
  return parts.join(" ".repeat(gap)).replace(/\s+$/, "");
}

function pad(value: string, width: number, align: Align): string {
  const filler = " ".repeat(Math.max(0, width - displayWidth(value)));
  return align === "right" ? filler + value : value + filler;
}

function inferAlign(values: readonly string[]): Align {
  const filled = values.map((value) => stripAnsi(value).trim()).filter((value) => value !== "");
  if (filled.length === 0) return "left";
  return filled.every((value) => NUMERIC.test(value)) ? "right" : "left";
}

function toCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? String(value) : value;
}
