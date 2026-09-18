import { validationError } from "./errors.js";

export interface CsvParseOptions {
  delimiter?: string;
  trim?: boolean;
}

export interface CsvReadOptions extends CsvParseOptions {
  strict?: boolean;
}

export interface CsvRecord {
  line: number;
  values: string[];
  record: Record<string, string>;
}

export interface CsvTable {
  headers: string[];
  records: CsvRecord[];
}

export interface CsvFormatOptions {
  delimiter?: string;
  eol?: string;
  bom?: boolean;
}

const BOM = "﻿";

export function parseCsv(text: string, options: CsvParseOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ",";
  if (delimiter.length !== 1) {
    throw validationError("CSV delimiter must be a single character.");
  }

  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = (): void => {
    row.push(options.trim === true ? field.trim() : field);
    field = "";
    quoted = false;
  };
  const endRow = (): void => {
    if (!started && row.length === 0 && field === "") return;
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      started = true;
      continue;
    }
    if (char === delimiter) {
      started = true;
      endField();
      continue;
    }
    if (char === "\r") {
      if (input[i + 1] === "\n") i += 1;
      endRow();
      continue;
    }
    if (char === "\n") {
      endRow();
      continue;
    }
    field += char;
    started = true;
  }

  endRow();

  return rows;
}

export function readCsv(text: string, options: CsvReadOptions = {}): CsvTable {
  const rows = parseCsv(text, options);
  if (rows.length === 0) {
    throw validationError("The CSV file is empty. A header row is required.");
  }

  const headers = rows[0].map((header) => header.trim());
  const seen = new Set<string>();
  for (const header of headers) {
    if (header === "") {
      throw validationError("The CSV header row has an empty column name.");
    }
    if (seen.has(header)) {
      throw validationError(`The CSV header row repeats the column "${header}".`);
    }
    seen.add(header);
  }

  const records: CsvRecord[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const values = rows[i];
    if (options.strict === true && values.length !== headers.length) {
      throw validationError(
        `Row ${i + 1} has ${values.length} columns, the header has ${headers.length}.`,
      );
    }
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    records.push({ line: i + 1, values, record });
  }

  return { headers, records };
}

export function formatCsv(rows: readonly (readonly (string | number | null | undefined)[])[], options: CsvFormatOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  const eol = options.eol ?? "\r\n";
  const body = rows
    .map((row) => row.map((cell) => escapeCsvField(toField(cell), delimiter)).join(delimiter))
    .join(eol);
  const text = rows.length === 0 ? "" : `${body}${eol}`;
  return options.bom === true ? `${BOM}${text}` : text;
}

export function formatCsvRecords(
  records: readonly Record<string, string | number | null | undefined>[],
  headers?: readonly string[],
  options: CsvFormatOptions = {},
): string {
  const columns = headers ?? uniqueKeys(records);
  const rows = [columns, ...records.map((record) => columns.map((column) => record[column]))];
  return formatCsv(rows, options);
}

export function escapeCsvField(value: string, delimiter = ","): string {
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value !== value.trim();
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function uniqueKeys(records: readonly Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

function toField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? String(value) : value;
}
