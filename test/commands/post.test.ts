import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/client.js", () => ({
  listPosts: vi.fn(),
  getPost: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  publishDraft: vi.fn(),
  unschedulePost: vi.fn(),
  listPostResults: vi.fn(),
  retryFailedPlatforms: vi.fn(),
  bulkSchedulePosts: vi.fn(),
  listSocialAccounts: vi.fn(),
  createUploadUrls: vi.fn(),
}));

const client = await import("../../src/api/client.js");
const { registerPostCommands } = await import("../../src/commands/post.js");
const { initOutput } = await import("../../src/core/output.js");

const workspace = mkdtempSync(join(tmpdir(), "adaptlypost-cli-post-"));

const accounts = [
  {
    id: "tw_4d1b",
    platform: "TWITTER",
    displayName: "Acme",
    username: "acme",
    avatarUrl: "",
    status: "active",
  },
  {
    id: "li_22aa",
    platform: "LINKEDIN",
    displayName: "Acme Inc",
    username: "acme-inc",
    avatarUrl: "",
    status: "active",
  },
];

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
  registerPostCommands(program);
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

describe("the post command tree", () => {
  it("registers every verb with its aliases", () => {
    const post = build().commands.find((command) => command.name() === "post");
    const names = post?.commands.map((command) => command.name()) ?? [];

    expect(names).toEqual([
      "list",
      "view",
      "create",
      "update",
      "delete",
      "publish",
      "unschedule",
      "results",
      "retry",
      "bulk",
      "watch",
    ]);

    const aliasOf = (name: string): string[] =>
      post?.commands.find((command) => command.name() === name)?.aliases() ?? [];

    expect(aliasOf("list")).toContain("ls");
    expect(aliasOf("delete")).toContain("rm");
    expect(aliasOf("view")).toContain("get");
  });
});

describe("post list", () => {
  it("passes the filters through and prints the machine document", async () => {
    vi.mocked(client.listPosts).mockResolvedValue({
      posts: [{ id: "post_1", status: "SCHEDULED", contentType: "TEXT", timezone: "UTC", platforms: [], createdAt: "", updatedAt: "", userId: "u" }],
      total: 47,
      hasMore: true,
    } as never);

    await run(["post", "list", "--limit", "5", "--status", "SCHEDULED", "--platform", "TWITTER"]);

    expect(client.listPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 5,
        offset: 0,
        statuses: ["SCHEDULED"],
        platforms: ["TWITTER"],
        sortOrder: "NEWEST",
      }),
    );

    const document = stdoutJson();
    expect(document.ok).toBe(true);
    expect(document.command).toBe("post.list");
    expect(document.meta).toMatchObject({ total: 47, hasMore: true });
  });

  it("refuses a status that is not in the enum", async () => {
    await expect(run(["post", "list", "--status", "NOPE"])).rejects.toMatchObject({ exitCode: 2 });
  });

  it("refuses a limit outside the endpoint's bounds", async () => {
    await expect(run(["post", "list", "--limit", "500"])).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe("post create", () => {
  beforeEach(() => {
    vi.mocked(client.listSocialAccounts).mockResolvedValue({ accounts } as never);
  });

  it("routes accounts into their platform arrays and sends the post", async () => {
    vi.mocked(client.createPost).mockResolvedValue({
      postId: "post_9c3e1f",
      queuedPlatforms: ["TWITTER", "LINKEDIN"],
      skippedPlatforms: [],
      isScheduled: false,
    } as never);

    await run([
      "post",
      "create",
      "-t",
      "Shipping the CLI today.",
      "-P",
      "TWITTER",
      "-P",
      "LINKEDIN",
      "-a",
      "tw_4d1b",
      "-a",
      "li_22aa",
    ]);

    expect(client.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Shipping the CLI today.",
        platforms: ["TWITTER", "LINKEDIN"],
        contentType: "TEXT",
        timezone: "UTC",
        twitterConnectionIds: ["tw_4d1b"],
        linkedinConnectionIds: ["li_22aa"],
      }),
    );
  });

  it("reads the post from a markdown file and lets flags win", async () => {
    const file = join(workspace, "launch.md");
    writeFileSync(
      file,
      [
        "---",
        "platforms: [TWITTER]",
        "accounts: [tw_4d1b]",
        "at: 2026-09-20T09:00:00Z",
        "timezone: Europe/Berlin",
        "---",
        "From the file.",
        "",
      ].join("\n"),
    );

    await run(["post", "create", "--file", file, "--timezone", "UTC", "--dry-run"]);

    const body = stdoutJson().data as Record<string, unknown>;
    expect(body).toMatchObject({
      text: "From the file.",
      platforms: ["TWITTER"],
      timezone: "UTC",
      scheduledAt: "2026-09-20T09:00:00.000Z",
      twitterConnectionIds: ["tw_4d1b"],
    });
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("fails before the write when an account is not in the workspace", async () => {
    await expect(
      run(["post", "create", "-t", "hi", "-P", "TWITTER", "-a", "nope"]),
    ).rejects.toMatchObject({ exitCode: 4 });
    expect(client.createPost).not.toHaveBeenCalled();
  });
});

describe("post update", () => {
  it("refuses --media without --platform", async () => {
    await expect(
      run(["post", "update", "post_1", "--media", "hero.jpg"]),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(client.updatePost).not.toHaveBeenCalled();
  });

  it("refuses an update that changes nothing", async () => {
    await expect(run(["post", "update", "post_1"])).rejects.toMatchObject({ exitCode: 2 });
  });

  it("sends only the fields that were given", async () => {
    vi.mocked(client.updatePost).mockResolvedValue({
      id: "post_1",
      status: "SCHEDULED",
      contentType: "TEXT",
      timezone: "UTC",
      platforms: [],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    } as never);

    await run(["post", "update", "post_1", "-t", "new text"]);

    expect(client.updatePost).toHaveBeenCalledWith("post_1", { text: "new text" });
  });
});

describe("post delete", () => {
  it("deletes without a prompt under --yes", async () => {
    vi.mocked(client.deletePost).mockResolvedValue({ deleted: true } as never);

    await run(["post", "delete", "post_1", "--yes"]);

    expect(client.deletePost).toHaveBeenCalledWith("post_1");
    expect(stdoutJson()).toMatchObject({ ok: true, command: "post.delete" });
  });
});

describe("post publish", () => {
  it("sends the resolved timezone and schedule", async () => {
    vi.mocked(client.publishDraft).mockResolvedValue({
      postId: "post_1",
      queuedPlatforms: [],
      isScheduled: true,
      scheduledAt: "2026-09-20T09:00:00.000Z",
    } as never);

    await run(["post", "publish", "post_1", "--at", "2026-09-20T09:00:00Z"]);

    expect(client.publishDraft).toHaveBeenCalledWith("post_1", {
      timezone: "UTC",
      scheduledAt: "2026-09-20T09:00:00.000Z",
    });
  });
});

describe("post unschedule", () => {
  it("unschedules the post and reports it as a draft", async () => {
    vi.mocked(client.unschedulePost).mockResolvedValue({ id: "post_1", status: "DRAFT", scheduledAt: null } as never);

    await run(["post", "unschedule", "post_1"]);

    expect(client.unschedulePost).toHaveBeenCalledWith("post_1");
    expect(stdoutJson()).toMatchObject({ ok: true, command: "post.unschedule", data: { id: "post_1", status: "DRAFT" } });
  });
});

describe("post retry", () => {
  it("collects the failed platform ids with --failed", async () => {
    vi.mocked(client.listPostResults).mockResolvedValue({
      postId: "post_1",
      status: "PARTIAL_FAILURE",
      results: [
        { platformId: "pp_1", platform: "TWITTER", status: "PUBLISHED" },
        { platformId: "pp_2", platform: "LINKEDIN", status: "FAILED" },
      ],
    } as never);
    vi.mocked(client.retryFailedPlatforms).mockResolvedValue({
      postId: "post_1",
      queuedPlatforms: ["LINKEDIN"],
      isScheduled: false,
    } as never);

    await run(["post", "retry", "post_1", "--failed"]);

    expect(client.retryFailedPlatforms).toHaveBeenCalledWith("post_1", { platformIds: ["pp_2"] });
  });

  it("refuses a retry with no platform", async () => {
    await expect(run(["post", "retry", "post_1"])).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe("post bulk", () => {
  const csvPath = (contents: string): string => {
    const path = join(workspace, `bulk-${Math.random().toString(16).slice(2)}.csv`);
    writeFileSync(path, contents);
    return path;
  };

  it("validates every row and builds one request per chunk", async () => {
    const path = csvPath(
      [
        "text,scheduledAt",
        "First post,2026-09-19T09:00:00Z",
        "Second post,2026-09-20T09:00:00Z",
        "",
      ].join("\n"),
    );

    await run(["post", "bulk", "--csv", path, "-P", "TWITTER", "--dry-run"]);

    const batches = stdoutJson().data as Record<string, unknown>[];
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ platforms: ["TWITTER"], timezone: "UTC" });
    expect((batches[0].posts as unknown[]).length).toBe(2);
    expect(client.bulkSchedulePosts).not.toHaveBeenCalled();
  });

  it("refuses an unknown column instead of dropping it", async () => {
    const path = csvPath(["text,scheduledAt,nonsense", "a,2026-09-19T09:00:00Z,b", ""].join("\n"));

    await expect(run(["post", "bulk", "--csv", path, "-P", "TWITTER"])).rejects.toMatchObject({
      exitCode: 5,
    });
  });

  it("refuses a row whose date does not parse, before sending anything", async () => {
    const path = csvPath(["text,scheduledAt", "a,2026-09-31T99:00:00Z", ""].join("\n"));

    await expect(run(["post", "bulk", "--csv", path, "-P", "TWITTER"])).rejects.toMatchObject({
      exitCode: 5,
    });
    expect(client.bulkSchedulePosts).not.toHaveBeenCalled();
  });

  it("reports a per-row failure with its row number and exits non-zero", async () => {
    const path = csvPath(
      ["text,scheduledAt", "a,2026-09-19T09:00:00Z", "b,2026-09-20T09:00:00Z", ""].join("\n"),
    );

    vi.mocked(client.bulkSchedulePosts).mockResolvedValue({
      totalScheduled: 1,
      totalFailed: 1,
      results: [
        { success: true, postId: "post_1", isScheduled: true },
        { success: false, isScheduled: false, errorMessage: "account disconnected" },
      ],
    } as never);

    await expect(run(["post", "bulk", "--csv", path, "-P", "TWITTER"])).rejects.toMatchObject({
      exitCode: 1,
    });

    expect(stdoutJson().meta).toMatchObject({ total: 2, scheduled: 1, failed: 1 });
  });

  it("refuses more than one source", async () => {
    await expect(
      run(["post", "bulk", "--csv", "a.csv", "--dir", "./posts"]),
    ).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe("post watch", () => {
  it("exits 1 when a platform ends FAILED", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_1",
      status: "PUBLISHING",
      contentType: "TEXT",
      timezone: "UTC",
      platforms: [
        { id: "pp_1", platform: "TWITTER", status: "PENDING", mediaUrls: [], createdAt: "", updatedAt: "" },
        { id: "pp_2", platform: "LINKEDIN", status: "PENDING", mediaUrls: [], createdAt: "", updatedAt: "" },
      ],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    } as never);

    vi.mocked(client.listPostResults).mockResolvedValue({
      postId: "post_1",
      status: "PARTIAL_FAILURE",
      results: [
        { platformId: "pp_1", platform: "TWITTER", status: "PUBLISHED", platformPostId: "1836" },
        { platformId: "pp_2", platform: "LINKEDIN", status: "FAILED", errorMessage: "token expired" },
      ],
    } as never);

    await expect(run(["post", "watch", "post_1"])).rejects.toMatchObject({ exitCode: 1 });

    expect(stdoutJson().meta).toMatchObject({ published: 1, failed: 1 });
  });

  it("exits 0 when every platform published", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_2",
      status: "PUBLISHING",
      contentType: "TEXT",
      timezone: "UTC",
      platforms: [],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    } as never);

    vi.mocked(client.listPostResults).mockResolvedValue({
      postId: "post_2",
      status: "COMPLETED",
      results: [{ platformId: "pp_1", platform: "TWITTER", status: "PUBLISHED" }],
    } as never);

    await run(["post", "watch", "post_2"]);

    expect(stdoutJson().meta).toMatchObject({ published: 1, failed: 0, reason: "until" });
  });

  it("refuses a timeout that is not a duration", async () => {
    await expect(run(["post", "watch", "post_1", "--timeout", "soon"])).rejects.toMatchObject({
      exitCode: 2,
    });
  });
});
