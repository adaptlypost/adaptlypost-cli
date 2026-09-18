import { describe, expect, it } from "vitest";
import { escapeCsvField, formatCsv, formatCsvRecords, parseCsv, readCsv } from "../../src/core/csv.js";

describe("parseCsv", () => {
  it("parses a plain table", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a leading BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('text,at\n"Hello, world",2026-09-20\n')).toEqual([
      ["text", "at"],
      ["Hello, world", "2026-09-20"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a\n"She said ""hi"""\n')).toEqual([["a"], ['She said "hi"']]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line one\nline two",x\n')).toEqual([
      ["a", "b"],
      ["line one\nline two", "x"],
    ]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("skips blank lines but keeps an explicitly quoted empty field", () => {
    expect(parseCsv("a\n\n1\n")).toEqual([["a"], ["1"]]);
    expect(parseCsv('a\n""\n')).toEqual([["a"], [""]]);
  });

  it("parses a file with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("readCsv", () => {
  it("maps rows onto the header row and reports the file line", () => {
    const table = readCsv("text,scheduledAt\nhello,2026-09-20T09:00:00Z\n");
    expect(table.headers).toEqual(["text", "scheduledAt"]);
    expect(table.records).toEqual([
      {
        line: 2,
        values: ["hello", "2026-09-20T09:00:00Z"],
        record: { text: "hello", scheduledAt: "2026-09-20T09:00:00Z" },
      },
    ]);
  });

  it("fills missing trailing columns with empty strings", () => {
    const table = readCsv("a,b\n1\n");
    expect(table.records[0].record).toEqual({ a: "1", b: "" });
  });

  it("rejects a ragged row in strict mode", () => {
    expect(() => readCsv("a,b\n1\n", { strict: true })).toThrowError(/Row 2 has 1 columns/);
  });

  it("rejects a repeated column name", () => {
    expect(() => readCsv("a,a\n1,2\n")).toThrowError(/repeats the column "a"/);
  });

  it("rejects an empty file", () => {
    expect(() => readCsv("")).toThrowError(/header row is required/);
  });
});

describe("formatCsv", () => {
  it("writes CRLF rows by default", () => {
    expect(
      formatCsv([
        ["a", "b"],
        ["1", "2"],
      ]),
    ).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes fields that need it", () => {
    expect(formatCsv([["Hello, world", 'say "hi"', "line\nbreak"]], { eol: "\n" })).toBe(
      '"Hello, world","say ""hi""","line\nbreak"\n',
    );
  });

  it("can prepend a BOM", () => {
    expect(formatCsv([["a"]], { eol: "\n", bom: true })).toBe("﻿a\n");
  });

  it("round-trips through the reader", () => {
    const rows = [
      ["text", "scheduledAt"],
      ['A "quoted", comma', "2026-09-20T09:00:00Z"],
    ];
    expect(parseCsv(formatCsv(rows))).toEqual(rows);
  });

  it("writes records under a derived header row", () => {
    expect(formatCsvRecords([{ a: "1", b: 2 }], undefined, { eol: "\n" })).toBe("a,b\n1,2\n");
  });

  it("returns nothing for zero rows", () => {
    expect(formatCsv([])).toBe("");
  });
});

describe("escapeCsvField", () => {
  it("leaves plain values alone", () => {
    expect(escapeCsvField("plain")).toBe("plain");
  });

  it("quotes padded values", () => {
    expect(escapeCsvField(" padded ")).toBe('" padded "');
  });
});
