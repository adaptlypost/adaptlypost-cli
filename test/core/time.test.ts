import { describe, expect, it } from "vitest";
import {
  assertTimeZone,
  formatAbsolute,
  formatDate,
  formatDuration,
  formatRelative,
  formatTimestamp,
  isValidTimeZone,
  parseDuration,
  parseIso,
  parseWhen,
} from "../../src/core/time.js";

const now = new Date("2026-09-18T09:41:00Z");

describe("parseDuration", () => {
  it("reads single units", () => {
    expect(parseDuration("30m")).toBe(30 * 60_000);
    expect(parseDuration("2h")).toBe(2 * 3_600_000);
    expect(parseDuration("3d")).toBe(3 * 86_400_000);
    expect(parseDuration("1w")).toBe(7 * 86_400_000);
  });

  it("reads compound and signed durations", () => {
    expect(parseDuration("1h30m")).toBe(90 * 60_000);
    expect(parseDuration("+15s")).toBe(15_000);
    expect(parseDuration("-2h")).toBe(-2 * 3_600_000);
  });

  it("rejects junk", () => {
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("2x")).toBeNull();
    expect(parseDuration("2h junk")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});

describe("parseWhen", () => {
  it("reads now", () => {
    expect(parseWhen("now", { now }).toISOString()).toBe("2026-09-18T09:41:00.000Z");
  });

  it("reads a signed offset", () => {
    expect(parseWhen("+2h", { now }).toISOString()).toBe("2026-09-18T11:41:00.000Z");
    expect(parseWhen("-30m", { now }).toISOString()).toBe("2026-09-18T09:11:00.000Z");
  });

  it("reads a bare duration as an offset from now", () => {
    expect(parseWhen("2d", { now }).toISOString()).toBe("2026-09-20T09:41:00.000Z");
  });

  it("reads an ISO 8601 instant", () => {
    expect(parseWhen("2026-09-20T09:00:00Z", { now }).toISOString()).toBe("2026-09-20T09:00:00.000Z");
    expect(parseWhen("2026-09-20T09:00:00+02:00", { now }).toISOString()).toBe("2026-09-20T07:00:00.000Z");
  });

  it("reads a local date as midnight in the given zone", () => {
    expect(parseWhen("2026-09-20", { now, timezone: "Europe/Berlin" }).toISOString()).toBe(
      "2026-09-19T22:00:00.000Z",
    );
    expect(parseWhen("2026-09-20", { now, timezone: "UTC" }).toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("reads a local date and time in the given zone", () => {
    expect(parseWhen("2026-09-20 09:00", { now, timezone: "Europe/Berlin" }).toISOString()).toBe(
      "2026-09-20T07:00:00.000Z",
    );
  });

  it("reads tomorrow with a clock time in the given zone", () => {
    expect(parseWhen("tomorrow 09:00", { now, timezone: "UTC" }).toISOString()).toBe(
      "2026-09-19T09:00:00.000Z",
    );
    expect(
      parseWhen("tomorrow 09:00", { now: new Date("2026-09-18T22:30:00Z"), timezone: "Europe/Berlin" }).toISOString(),
    ).toBe("2026-09-20T07:00:00.000Z");
  });

  it("reads today and yesterday", () => {
    expect(parseWhen("today", { now, timezone: "UTC" }).toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(parseWhen("yesterday 23:30", { now, timezone: "UTC" }).toISOString()).toBe(
      "2026-09-17T23:30:00.000Z",
    );
  });

  it("crosses a DST boundary correctly", () => {
    expect(parseWhen("2026-01-15 09:00", { now, timezone: "Europe/Berlin" }).toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
  });

  it("fails with a usage exit code on junk", () => {
    try {
      parseWhen("next tuesday-ish", { now });
      expect.unreachable();
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(2);
    }
  });
});

describe("parseIso", () => {
  it("returns a date for ISO input", () => {
    expect(parseIso("2026-09-20T09:00:00Z")?.toISOString()).toBe("2026-09-20T09:00:00.000Z");
    expect(parseIso("2026-09-20")?.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("returns null for anything else", () => {
    expect(parseIso("+2h")).toBeNull();
    expect(parseIso("")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats an absolute timestamp with its zone", () => {
    expect(formatAbsolute(new Date("2026-09-18T09:41:00Z"), { timezone: "Europe/Berlin" })).toBe(
      "2026-09-18 11:41 Europe/Berlin",
    );
    expect(formatAbsolute(new Date("2026-09-18T09:41:07Z"), { timezone: "UTC", seconds: true })).toBe(
      "2026-09-18 09:41:07 UTC",
    );
    expect(
      formatAbsolute(new Date("2026-09-18T09:41:00Z"), { timezone: "UTC", withZone: false }),
    ).toBe("2026-09-18 09:41");
  });

  it("formats a date in a zone", () => {
    expect(formatDate(new Date("2026-09-18T23:30:00Z"), "Europe/Berlin")).toBe("2026-09-19");
  });

  it("formats relative timestamps in both directions", () => {
    expect(formatRelative(new Date("2026-09-18T07:41:00Z"), { now })).toBe("2h ago");
    expect(formatRelative(new Date("2026-09-21T09:41:00Z"), { now })).toBe("in 3d");
    expect(formatRelative(new Date("2026-09-18T09:40:30Z"), { now })).toBe("30s ago");
    expect(formatRelative(new Date("2026-09-18T09:41:00Z"), { now })).toBe("now");
    expect(formatRelative(new Date("2027-09-18T09:41:00Z"), { now })).toBe("in 1y");
  });

  it("combines absolute and relative", () => {
    expect(formatTimestamp(new Date("2026-09-18T11:41:00Z"), { now, timezone: "UTC" })).toBe(
      "2026-09-18 11:41 UTC (in 2h)",
    );
  });

  it("formats durations", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(22_000)).toBe("22s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(9_000_000)).toBe("2h 30m");
    expect(formatDuration(97_200_000)).toBe("1d 3h");
  });
});

describe("time zones", () => {
  it("accepts IANA names", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("throws a usage error from assertTimeZone", () => {
    try {
      assertTimeZone("Mars/Olympus");
      expect.unreachable();
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(2);
    }
  });
});
