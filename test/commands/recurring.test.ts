import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecurringPost } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", () => ({
  listRecurringPosts: vi.fn(),
  getRecurringPost: vi.fn(),
  pauseRecurringPost: vi.fn(),
  resumeRecurringPost: vi.fn(),
  deleteRecurringPost: vi.fn(),
}));

const client = await import("../../src/api/client.js");
const { describeRecurrence, registerRecurringCommands } = await import("../../src/commands/recurring.js");
const { initOutput } = await import("../../src/core/output.js");

const workspace = mkdtempSync(join(tmpdir(), "adaptlypost-cli-recurring-"));

const series: RecurringPost = {
  id: "rp_1",
  userId: "u",
  status: "ACTIVE",
  frequency: "WEEKLY",
  interval: 1,
  weekdays: ["MONDAY", "THURSDAY"],
  startsAt: "2027-01-04T09:00:00.000Z",
  timezone: "UTC",
  nextOccurrenceAt: "2027-01-07T09:00:00.000Z",
  occurrenceCount: 1,
  contentType: "TEXT",
  text: "Weekly tip",
  mediaUrls: [],
  platformTypes: ["TWITTER"],
  platforms: [],
  createdAt: "",
  updatedAt: "",
};

let written: string[] = [];

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program
    .option("-p, --profile <name>")
    .option("--json")
    .option("-q, --quiet")
    .option("-y, --yes")
    .option("--no-input")
    .option("--full-ids");
  registerRecurringCommands(program);
  return program;
};

const run = (argv: string[]): Promise<unknown> =>
  build().parseAsync(argv, { from: "user" });

const stdoutJson = (): Record<string, unknown> =>
  JSON.parse(written.join("")) as Record<string, unknown>;

beforeEach(() => {
  vi.stubEnv("XDG_CONFIG_HOME", workspace);
  vi.stubEnv("CI", "");
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  initOutput({ json: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the recurring command tree", () => {
  it("registers every verb with its aliases", () => {
    const recurring = build().commands.find((command) => command.name() === "recurring");
    const names = recurring?.commands.map((command) => command.name()) ?? [];

    expect(names).toEqual(["list", "view", "pause", "resume", "delete"]);

    const aliasOf = (name: string): string[] =>
      recurring?.commands.find((command) => command.name() === name)?.aliases() ?? [];

    expect(aliasOf("list")).toContain("ls");
    expect(aliasOf("view")).toContain("get");
    expect(aliasOf("delete")).toContain("rm");
  });
});

describe("recurring list", () => {
  it("passes the filters through and prints the machine document", async () => {
    vi.mocked(client.listRecurringPosts).mockResolvedValue({
      recurringPosts: [series],
      total: 3,
      hasMore: true,
    });

    await run(["recurring", "list", "--limit", "1", "--offset", "2", "--status", "active", "--status", "PAUSED"]);

    expect(client.listRecurringPosts).toHaveBeenCalledWith({
      statuses: ["ACTIVE", "PAUSED"],
      limit: 1,
      offset: 2,
    });

    const document = stdoutJson();
    expect(document).toMatchObject({ ok: true, command: "recurring.list" });
    expect(document.meta).toMatchObject({ total: 3, limit: 1, offset: 2, hasMore: true });
  });

  it("refuses a status that is not in the enum", async () => {
    await expect(run(["recurring", "list", "--status", "SCHEDULED"])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.listRecurringPosts).not.toHaveBeenCalled();
  });

  it("refuses a limit outside the endpoint's bounds", async () => {
    await expect(run(["recurring", "list", "--limit", "101"])).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe("recurring view", () => {
  it("prints the recurring post as the API returned it", async () => {
    vi.mocked(client.getRecurringPost).mockResolvedValue(series);

    await run(["recurring", "get", "rp_1"]);

    expect(client.getRecurringPost).toHaveBeenCalledWith("rp_1");
    expect(stdoutJson()).toMatchObject({ command: "recurring.view", data: { id: "rp_1", status: "ACTIVE" } });
  });
});

describe("recurring pause and resume", () => {
  it("pauses the series", async () => {
    vi.mocked(client.pauseRecurringPost).mockResolvedValue({ ...series, status: "PAUSED", pauseReason: "USER" });

    await run(["recurring", "pause", "rp_1"]);

    expect(client.pauseRecurringPost).toHaveBeenCalledWith("rp_1");
    expect(stdoutJson()).toMatchObject({ command: "recurring.pause", data: { status: "PAUSED" } });
  });

  it("resumes the series", async () => {
    vi.mocked(client.resumeRecurringPost).mockResolvedValue(series);

    await run(["recurring", "resume", "rp_1"]);

    expect(client.resumeRecurringPost).toHaveBeenCalledWith("rp_1");
    expect(stdoutJson()).toMatchObject({ command: "recurring.resume", data: { status: "ACTIVE" } });
  });
});

describe("recurring delete", () => {
  it("deletes without a prompt under --yes", async () => {
    vi.mocked(client.deleteRecurringPost).mockResolvedValue({ deleted: true });

    await run(["recurring", "delete", "rp_1", "--yes"]);

    expect(client.getRecurringPost).not.toHaveBeenCalled();
    expect(client.deleteRecurringPost).toHaveBeenCalledWith("rp_1");
    expect(stdoutJson()).toMatchObject({ ok: true, command: "recurring.delete", data: { deleted: true } });
  });

  it("asks first and does not delete when it cannot prompt", async () => {
    vi.mocked(client.getRecurringPost).mockResolvedValue(series);

    await expect(run(["recurring", "delete", "rp_1", "--no-input"])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.deleteRecurringPost).not.toHaveBeenCalled();
  });
});

describe("describeRecurrence", () => {
  it("reads like the schedule it describes", () => {
    expect(describeRecurrence({ frequency: "DAILY" })).toBe("daily");
    expect(describeRecurrence({ frequency: "WEEKLY", interval: 2, weekdays: ["MONDAY", "THURSDAY"] })).toBe(
      "every 2 weeks on MONDAY, THURSDAY",
    );
    expect(describeRecurrence({ frequency: "MONTHLY", endsOn: "2027-06-30T00:00:00.000Z" })).toBe(
      "monthly until 2027-06-30",
    );
    expect(describeRecurrence({ frequency: "DAILY", maxOccurrences: 10 })).toBe("daily for 10 posts");
  });
});
