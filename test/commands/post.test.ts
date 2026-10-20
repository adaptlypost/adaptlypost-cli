import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SocialAccount } from "../../src/api/types.js";

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
  listPinterestBoards: vi.fn(),
  createUploadUrls: vi.fn(),
}));

const client = await import("../../src/api/client.js");
const { registerPostCommands } = await import("../../src/commands/post.js");
const { initOutput } = await import("../../src/core/output.js");

const workspace = mkdtempSync(join(tmpdir(), "adaptlypost-cli-post-"));

const accounts: SocialAccount[] = [
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
  {
    id: "ig_7c3e",
    platform: "INSTAGRAM",
    displayName: "Acme",
    username: "acme.ig",
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
      posts: [{ id: "post_1", status: "SCHEDULED", contentType: "TEXT", timezone: "UTC", mediaUrls: [], platforms: [], createdAt: "", updatedAt: "", userId: "u" }],
      total: 47,
      hasMore: true,
    });

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
    vi.mocked(client.listSocialAccounts).mockResolvedValue({ accounts });
  });

  it("routes accounts into their platform arrays and sends the post", async () => {
    vi.mocked(client.createPost).mockResolvedValue({
      postId: "post_9c3e1f",
      queuedPlatforms: ["TWITTER", "LINKEDIN"],
      skippedPlatforms: [],
      isScheduled: false,
    });

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

  it("builds a LinkedIn document post from --type DOCUMENT and --document-title", async () => {
    await run([
      "post",
      "create",
      "-t",
      "Our Q3 report",
      "-a",
      "li_22aa",
      "--type",
      "document",
      "-m",
      "https://cdn.example.com/q3.pdf",
      "--document-title",
      "Q3 report",
      "--dry-run",
    ]);

    const body = stdoutJson().data as Record<string, unknown>;
    expect(body).toMatchObject({
      platforms: ["LINKEDIN"],
      contentType: "DOCUMENT",
      mediaUrls: ["https://cdn.example.com/q3.pdf"],
      linkedinConnectionIds: ["li_22aa"],
      linkedinConfigs: [{ connectionId: "li_22aa", documentTitle: "Q3 report" }],
    });
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("publishes an Instagram reel as a trial reel from --ig-type and --ig-trial", async () => {
    await run([
      "post",
      "create",
      "-t",
      "Behind the scenes",
      "-a",
      "ig_7c3e",
      "-m",
      "https://cdn.example.com/clip.mp4",
      "--ig-type",
      "reel",
      "--ig-trial",
      "ss_performance",
      "--dry-run",
    ]);

    expect(stdoutJson().data).toMatchObject({
      instagramConnectionIds: ["ig_7c3e"],
      instagramConfigs: [{ connectionId: "ig_7c3e", postType: "REEL", trialGraduation: "SS_PERFORMANCE" }],
    });
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("refuses an unknown --ig-trial value before sending anything", async () => {
    await expect(
      run(["post", "create", "-t", "Clip", "-a", "ig_7c3e", "-m", "https://cdn/clip.mp4", "--ig-trial", "later"]),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("infers DOCUMENT from a single document file", async () => {
    await run(["post", "create", "-t", "Deck", "-a", "li_22aa", "-m", "https://cdn/deck.pptx", "--dry-run"]);

    expect((stdoutJson().data as Record<string, unknown>).contentType).toBe("DOCUMENT");
  });

  it("refuses a DOCUMENT post aimed at another platform before sending it", async () => {
    await expect(
      run(["post", "create", "-t", "Deck", "-a", "li_22aa", "-a", "tw_4d1b", "-m", "https://cdn/deck.pdf"]),
    ).rejects.toMatchObject({ exitCode: 5 });
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("sends a recurrence built from --repeat, --every, --on and --until", async () => {
    await run([
      "post",
      "create",
      "-t",
      "Weekly tip",
      "-a",
      "tw_4d1b",
      "--at",
      "2027-01-04T09:00:00Z",
      "--repeat",
      "weekly",
      "--every",
      "2",
      "--on",
      "mon",
      "--on",
      "THURSDAY",
      "--until",
      "2027-06-30",
      "--dry-run",
    ]);

    expect((stdoutJson().data as Record<string, unknown>).recurrence).toEqual({
      frequency: "WEEKLY",
      interval: 2,
      weekdays: ["MONDAY", "THURSDAY"],
      endsOn: "2027-06-30",
    });
  });

  it("sends a yearly recurrence", async () => {
    await run(["post", "create", "-t", "Happy birthday, Acme", "-a", "tw_4d1b", "--at", "2027-03-01T09:00:00Z", "--repeat", "yearly", "--count", "5", "--dry-run"]);

    expect((stdoutJson().data as Record<string, unknown>).recurrence).toEqual({ frequency: "YEARLY", maxOccurrences: 5 });
  });

  it("returns the recurringPostId the API sends back", async () => {
    vi.mocked(client.createPost).mockResolvedValue({
      postId: "post_1",
      queuedPlatforms: ["TWITTER"],
      skippedPlatforms: [],
      isScheduled: true,
      scheduledAt: "2027-01-04T09:00:00.000Z",
      recurringPostId: "rp_1",
    });

    await run(["post", "create", "-t", "Daily", "-a", "tw_4d1b", "--at", "2027-01-04T09:00:00Z", "--repeat", "DAILY", "--count", "10"]);

    expect(client.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence: { frequency: "DAILY", maxOccurrences: 10 } }),
    );
    expect(stdoutJson()).toMatchObject({ command: "post.create", data: { recurringPostId: "rp_1" } });
  });

  it("reads the repeat keys from the frontmatter and lets --count replace until", async () => {
    const file = join(workspace, "weekly.md");
    writeFileSync(
      file,
      ["---", "accounts: [tw_4d1b]", "at: 2027-01-04T09:00:00Z", "repeat: WEEKLY", "until: 2027-06-30", "---", "Tip", ""].join("\n"),
    );

    await run(["post", "create", "--file", file, "--count", "5", "--dry-run"]);

    expect((stdoutJson().data as Record<string, unknown>).recurrence).toEqual({
      frequency: "WEEKLY",
      maxOccurrences: 5,
    });
  });

  it("refuses bad repeat flags before sending anything", async () => {
    const base = ["post", "create", "-t", "hi", "-a", "tw_4d1b", "--at", "2027-01-04T09:00:00Z"];

    for (const flags of [
      ["--repeat", "DAILY", "--until", "2027-02-01", "--count", "5"],
      ["--repeat", "DAILY", "--every", "0"],
      ["--repeat", "DAILY", "--count", "366"],
      ["--repeat", "WEEKLY", "--on", "mon,thu"],
      ["--repeat", "WEEKLY", "--on", "someday"],
      ["--repeat", "HOURLY"],
      ["--repeat", "DAILY", "--until", "31/12/2027"],
      ["--every", "2"],
    ]) {
      await expect(run([...base, ...flags])).rejects.toMatchObject({ exitCode: 2 });
    }
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("refuses --repeat without --at", async () => {
    await expect(
      run(["post", "create", "-t", "hi", "-a", "tw_4d1b", "--repeat", "DAILY"]),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("refuses --repeat with --draft", async () => {
    await expect(
      run(["post", "create", "-t", "hi", "-a", "tw_4d1b", "--at", "2027-01-04T09:00:00Z", "--repeat", "DAILY", "--draft"]),
    ).rejects.toMatchObject({ exitCode: 5 });
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("refuses a misnamed --config key instead of letting the API drop it", async () => {
    await expect(
      run(["post", "create", "-t", "hi", "-a", "ig_7c3e", "--config", 'INSTAGRAM={"post_type":"REEL"}', "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: 5, message: expect.stringContaining('Did you mean "postType"') });
    expect(client.listSocialAccounts).not.toHaveBeenCalled();
  });

  it("refuses a misnamed key in a frontmatter platform block", async () => {
    const file = join(workspace, "bad-config.md");
    writeFileSync(file, ["---", "accounts: [ig_7c3e]", "instagram:", "  trial: MANUAL", "---", "Reel", ""].join("\n"));

    await expect(run(["post", "create", "--file", file, "--dry-run"])).rejects.toMatchObject({ exitCode: 5 });
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("refuses a connection id inside a platform config", async () => {
    await expect(
      run(["post", "create", "-t", "hi", "--config", 'YOUTUBE={"connectionId":"yt_1"}', "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: 5 });
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

  it("has no repeat flags", async () => {
    await expect(run(["post", "update", "post_1", "--repeat", "DAILY"])).rejects.toMatchObject({
      code: "commander.unknownOption",
    });
  });

  it("refuses a file that carries repeat keys", async () => {
    const file = join(workspace, "update-repeat.md");
    writeFileSync(file, ["---", "repeat: DAILY", "---", "New text", ""].join("\n"));

    await expect(run(["post", "update", "post_1", "--file", file])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.updatePost).not.toHaveBeenCalled();
  });

  it("refuses an update that changes nothing", async () => {
    await expect(run(["post", "update", "post_1"])).rejects.toMatchObject({ exitCode: 2 });
  });

  it("carries --document-title into linkedinConfigs with the LinkedIn account", async () => {
    vi.mocked(client.listSocialAccounts).mockResolvedValue({ accounts });

    await run(["post", "update", "post_1", "-a", "li_22aa", "--document-title", "Renamed deck", "--dry-run"]);

    expect(stdoutJson().data).toEqual({
      linkedinConnectionIds: ["li_22aa"],
      linkedinConfigs: [{ connectionId: "li_22aa", documentTitle: "Renamed deck" }],
    });
  });

  it("resends the current targets with --alt, because the API only saves alt text with them", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_1",
      status: "SCHEDULED",
      contentType: "IMAGE",
      text: "Launch",
      timezone: "UTC",
      mediaUrls: ["https://cdn/hero.png"],
      platforms: [
        { id: "pp_1", platform: "TWITTER", status: "PENDING", connectionId: "tw_4d1b", text: "Short launch", mediaUrls: [], mediaAltTexts: [], previewUrls: [], createdAt: "", updatedAt: "" },
        { id: "pp_2", platform: "INSTAGRAM", status: "PENDING", connectionId: "ig_7c3e", instagramPostType: "FEED", mediaUrls: [], mediaAltTexts: [], previewUrls: [], createdAt: "", updatedAt: "" },
        { id: "pp_3", platform: "FACEBOOK", status: "PENDING", pageId: "fb_page_1", mediaUrls: [], mediaAltTexts: [], previewUrls: [], createdAt: "", updatedAt: "" },
        { id: "pp_4", platform: "TIKTOK", status: "PENDING", connectionId: "tt_1", tiktokPrivacyLevel: "SELF_ONLY", tiktokAllowDuet: false, mediaUrls: [], mediaAltTexts: [], previewUrls: [], createdAt: "", updatedAt: "" },
      ],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

    await run(["post", "update", "post_1", "--alt", "The CLI in a dark terminal", "--dry-run"]);

    expect(client.getPost).toHaveBeenCalledWith("post_1");
    expect(stdoutJson().data).toEqual({
      mediaAltTexts: ["The CLI in a dark terminal"],
      platforms: ["TWITTER", "INSTAGRAM", "FACEBOOK", "TIKTOK"],
      twitterConnectionIds: ["tw_4d1b"],
      instagramConnectionIds: ["ig_7c3e"],
      instagramConfigs: [{ connectionId: "ig_7c3e", postType: "FEED" }],
      pageIds: ["fb_page_1"],
      tiktokConnectionIds: ["tt_1"],
      tiktokConfigs: [{ connectionId: "tt_1", privacyLevel: "SELF_ONLY", allowDuet: false }],
      platformTexts: [{ platform: "TWITTER", text: "Short launch" }],
    });
  });

  it("reads alt text from a file for an update", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_1",
      status: "DRAFT",
      contentType: "IMAGE",
      timezone: "UTC",
      mediaUrls: ["https://cdn/hero.png"],
      platforms: [
        { id: "pp_1", platform: "LINKEDIN", status: "PENDING", connectionId: "li_22aa", mediaUrls: [], mediaAltTexts: [], previewUrls: [], createdAt: "", updatedAt: "" },
      ],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });
    const file = join(workspace, "update-alt.md");
    writeFileSync(file, ["---", 'alt: ["A chart going up"]', "---", ""].join("\n"));

    await run(["post", "update", "post_1", "--file", file, "--dry-run"]);

    expect(stdoutJson().data).toMatchObject({
      mediaAltTexts: ["A chart going up"],
      platforms: ["LINKEDIN"],
      linkedinConnectionIds: ["li_22aa"],
    });
  });

  it("keeps --alt with a new target set instead of fetching the post", async () => {
    vi.mocked(client.listSocialAccounts).mockResolvedValue({ accounts });

    await run(["post", "update", "post_1", "-P", "TWITTER", "-a", "tw_4d1b", "--alt", "Hero", "--yes", "--dry-run"]);

    expect(client.getPost).not.toHaveBeenCalled();
    expect(stdoutJson().data).toMatchObject({
      platforms: ["TWITTER"],
      twitterConnectionIds: ["tw_4d1b"],
      mediaAltTexts: ["Hero"],
    });
  });

  it("refuses --alt with --account but no --platform", async () => {
    vi.mocked(client.listSocialAccounts).mockResolvedValue({ accounts });

    await expect(
      run(["post", "update", "post_1", "-a", "tw_4d1b", "--alt", "Hero", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(client.updatePost).not.toHaveBeenCalled();
  });

  it("sends only the fields that were given", async () => {
    vi.mocked(client.updatePost).mockResolvedValue({
      id: "post_1",
      status: "SCHEDULED",
      contentType: "TEXT",
      timezone: "UTC",
      mediaUrls: [],
      platforms: [],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

    await run(["post", "update", "post_1", "-t", "new text"]);

    expect(client.updatePost).toHaveBeenCalledWith("post_1", { text: "new text" });
  });
});

describe("post delete", () => {
  it("deletes without a prompt under --yes", async () => {
    vi.mocked(client.deletePost).mockResolvedValue({ deleted: true });

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
    });

    await run(["post", "publish", "post_1", "--at", "2026-09-20T09:00:00Z"]);

    expect(client.publishDraft).toHaveBeenCalledWith("post_1", {
      timezone: "UTC",
      scheduledAt: "2026-09-20T09:00:00.000Z",
    });
  });
});

describe("post unschedule", () => {
  it("unschedules the post and reports it as a draft", async () => {
    vi.mocked(client.unschedulePost).mockResolvedValue({
      id: "post_1",
      status: "DRAFT",
      contentType: "TEXT",
      timezone: "UTC",
      mediaUrls: [],
      platforms: [],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

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
    });
    vi.mocked(client.retryFailedPlatforms).mockResolvedValue({
      postId: "post_1",
      queuedPlatforms: ["LINKEDIN"],
      isScheduled: false,
    });

    await run(["post", "retry", "post_1", "--failed"]);

    expect(client.retryFailedPlatforms).toHaveBeenCalledWith("post_1", { platformIds: ["pp_2"] });
  });

  it("retries every failed platform when no flag is given", async () => {
    vi.mocked(client.retryFailedPlatforms).mockResolvedValue({
      postId: "post_1",
      queuedPlatforms: ["LINKEDIN", "BLUESKY"],
      isScheduled: false,
    } as never);

    await run(["post", "retry", "post_1"]);

    expect(client.retryFailedPlatforms).toHaveBeenCalledWith("post_1", {});
  });

  it("sends platform names alongside ids", async () => {
    vi.mocked(client.retryFailedPlatforms).mockResolvedValue({
      postId: "post_1",
      queuedPlatforms: ["BLUESKY"],
      isScheduled: false,
    } as never);

    await run(["post", "retry", "post_1", "--platform-id", "pp_2", "-P", "bluesky"]);

    expect(client.retryFailedPlatforms).toHaveBeenCalledWith("post_1", { platformIds: ["pp_2", "BLUESKY"] });
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
    expect(batches[0].posts).toHaveLength(2);
    expect(client.bulkSchedulePosts).not.toHaveBeenCalled();
  });

  it("refuses DOCUMENT rows and config_LINKEDIN, before sending anything", async () => {
    for (const rows of [
      ["text,scheduledAt,contentType,media", "Deck,2026-09-19T09:00:00Z,DOCUMENT,https://cdn/deck.pdf"],
      ["text,scheduledAt,media", "Report,2026-09-20T09:00:00Z,https://cdn/report.docx"],
      ["text,scheduledAt,config_LINKEDIN", 'Deck,2026-09-19T09:00:00Z,"{""documentTitle"":""Q3 deck""}"'],
    ]) {
      const path = csvPath([...rows, ""].join("\n"));

      await expect(run(["post", "bulk", "--csv", path, "-P", "LINKEDIN"])).rejects.toMatchObject({
        exitCode: 5,
      });
    }
    expect(client.bulkSchedulePosts).not.toHaveBeenCalled();
  });

  it("refuses a --dir post with a LinkedIn document title", async () => {
    const dir = mkdtempSync(join(workspace, "posts-"));
    writeFileSync(
      join(dir, "01.md"),
      ["---", "at: 2026-09-19T09:00:00Z", "type: DOCUMENT", "documentTitle: Launch deck", "---", "Deck", ""].join("\n"),
    );

    await expect(run(["post", "bulk", "--dir", dir, "-P", "LINKEDIN"])).rejects.toMatchObject({
      exitCode: 5,
    });
    expect(client.bulkSchedulePosts).not.toHaveBeenCalled();
  });

  it("infers the content type of a --dir post from its media", async () => {
    const dir = mkdtempSync(join(workspace, "posts-"));
    writeFileSync(join(dir, "01.md"), ["---", "at: 2026-09-19T09:00:00Z", "media: [https://cdn/clip.mp4]", "---", "Clip", ""].join("\n"));
    writeFileSync(
      join(dir, "02.md"),
      ["---", "at: 2026-09-20T09:00:00Z", "media: [https://cdn/a.png, https://cdn/b.png]", "---", "Pair", ""].join("\n"),
    );
    writeFileSync(join(dir, "03.md"), ["---", "at: 2026-09-21T09:00:00Z", "---", "Words", ""].join("\n"));

    await run(["post", "bulk", "--dir", dir, "-P", "TWITTER", "--dry-run"]);

    const [batch] = stdoutJson().data as { posts: { contentType: string }[] }[];
    expect(batch?.posts.map((item) => item.contentType)).toEqual(["VIDEO", "CAROUSEL", "TEXT"]);
  });

  it("refuses a --dir post with a misnamed config key", async () => {
    const dir = mkdtempSync(join(workspace, "posts-"));
    writeFileSync(
      join(dir, "01.md"),
      ["---", "at: 2026-09-19T09:00:00Z", "youtube:", "  title: Launch", "---", "Clip", ""].join("\n"),
    );

    await expect(run(["post", "bulk", "--dir", dir, "-P", "YOUTUBE"])).rejects.toMatchObject({
      exitCode: 5,
      message: expect.stringContaining("01.md"),
    });
  });

  it("reads an alt column aligned with media", async () => {
    const path = csvPath(
      ["text,scheduledAt,media,alt", "Pair,2026-09-19T09:00:00Z,https://cdn/a.png;https://cdn/b.png,First;Second", ""].join("\n"),
    );

    await run(["post", "bulk", "--csv", path, "-P", "TWITTER", "--dry-run"]);

    const [batch] = stdoutJson().data as { posts: Record<string, unknown>[] }[];
    expect(batch?.posts[0]).toMatchObject({
      contentType: "CAROUSEL",
      mediaUrls: ["https://cdn/a.png", "https://cdn/b.png"],
      mediaAltTexts: ["First", "Second"],
    });
  });

  it("refuses more alt texts than media files in a row", async () => {
    const path = csvPath(["text,scheduledAt,media,alt", "One,2026-09-19T09:00:00Z,https://cdn/a.png,First;Second", ""].join("\n"));

    await expect(run(["post", "bulk", "--csv", path, "-P", "TWITTER"])).rejects.toMatchObject({ exitCode: 5 });
  });

  it("refuses a misnamed key in a config column with its row number", async () => {
    const path = csvPath(
      ["text,scheduledAt,config_TIKTOK", 'Clip,2026-09-19T09:00:00Z,"{""privacy"":""SELF_ONLY""}"', ""].join("\n"),
    );

    await expect(run(["post", "bulk", "--csv", path, "-P", "TIKTOK"])).rejects.toMatchObject({
      exitCode: 5,
      message: expect.stringMatching(/^Row 2: Unknown TIKTOK config key "privacy"\. Did you mean "privacyLevel"\?/),
    });
  });

  it("refuses a --dir post with repeat keys", async () => {
    const dir = mkdtempSync(join(workspace, "posts-"));
    writeFileSync(
      join(dir, "01.md"),
      ["---", "at: 2027-01-04T09:00:00Z", "repeat: WEEKLY", "---", "Tip", ""].join("\n"),
    );

    await expect(run(["post", "bulk", "--dir", dir, "-P", "TWITTER"])).rejects.toMatchObject({
      exitCode: 5,
    });
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
    });

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
      mediaUrls: [],
      platforms: [
        { id: "pp_1", platform: "TWITTER", status: "PENDING", mediaUrls: [], mediaAltTexts: [], previewUrls: [], createdAt: "", updatedAt: "" },
        { id: "pp_2", platform: "LINKEDIN", status: "PENDING", mediaUrls: [], mediaAltTexts: [], previewUrls: [], createdAt: "", updatedAt: "" },
      ],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

    vi.mocked(client.listPostResults).mockResolvedValue({
      postId: "post_1",
      status: "PARTIAL_FAILURE",
      results: [
        { platformId: "pp_1", platform: "TWITTER", status: "PUBLISHED", platformPostId: "1836" },
        { platformId: "pp_2", platform: "LINKEDIN", status: "FAILED", errorMessage: "token expired" },
      ],
    });

    await expect(run(["post", "watch", "post_1"])).rejects.toMatchObject({ exitCode: 1 });

    expect(stdoutJson().meta).toMatchObject({ published: 1, failed: 1 });
  });

  it("exits 0 when every platform published", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_2",
      status: "PUBLISHING",
      contentType: "TEXT",
      timezone: "UTC",
      mediaUrls: [],
      platforms: [],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

    vi.mocked(client.listPostResults).mockResolvedValue({
      postId: "post_2",
      status: "COMPLETED",
      results: [{ platformId: "pp_1", platform: "TWITTER", status: "PUBLISHED" }],
    });

    await run(["post", "watch", "post_2"]);

    expect(stdoutJson().meta).toMatchObject({ published: 1, failed: 0, reason: "until" });
  });

  it("refuses a timeout that is not a duration", async () => {
    await expect(run(["post", "watch", "post_1", "--timeout", "soon"])).rejects.toMatchObject({
      exitCode: 2,
    });
  });
});

describe("per-platform options on create, update and bulk", () => {
  const withNewPlatforms: SocialAccount[] = [
    ...accounts,
    {
      id: "gbp_1",
      platform: "GOOGLE_BUSINESS",
      displayName: "Acme Bakery, Main St",
      username: "",
      avatarUrl: "",
      status: "active",
    },
    {
      id: "fb_1",
      platform: "FACEBOOK",
      displayName: "Acme Page",
      username: "",
      avatarUrl: "",
      status: "active",
      pageId: "102938",
    },
    {
      id: "yt_1",
      platform: "YOUTUBE",
      displayName: "Acme Channel",
      username: "acme",
      avatarUrl: "",
      status: "active",
    },
  ];

  const csvPath = (contents: string): string => {
    const path = join(workspace, `bulk-${Math.random().toString(16).slice(2)}.csv`);
    writeFileSync(path, contents);
    return path;
  };

  beforeEach(() => {
    vi.mocked(client.listSocialAccounts).mockResolvedValue({ accounts: withNewPlatforms });
  });

  it("builds a Google Business Profile offer from the --gbp flags", async () => {
    await run([
      "post",
      "create",
      "-t",
      "20% off all week",
      "-a",
      "gbp_1",
      "--gbp-topic",
      "offer",
      "--gbp-cta",
      "SHOP",
      "--gbp-cta-url",
      "https://acme.test/shop",
      "--gbp-event-title",
      "Autumn sale",
      "--gbp-event-start",
      "2026-10-20",
      "--gbp-event-end",
      "2026-10-27",
      "--gbp-coupon",
      "AUTUMN20",
      "--dry-run",
    ]);

    expect(stdoutJson().data).toMatchObject({
      platforms: ["GOOGLE_BUSINESS"],
      googleBusinessConnectionIds: ["gbp_1"],
      googleBusinessConfigs: [
        {
          connectionId: "gbp_1",
          topicType: "OFFER",
          callToActionType: "SHOP",
          callToActionUrl: "https://acme.test/shop",
          eventTitle: "Autumn sale",
          eventStart: "2026-10-20",
          eventEnd: "2026-10-27",
          offerCouponCode: "AUTUMN20",
        },
      ],
    });
  });

  it("sends Instagram and Facebook story, collaborator, audio and background options", async () => {
    await run([
      "post",
      "create",
      "-t",
      "New reel",
      "-a",
      "ig_7c3e",
      "-a",
      "fb_1",
      "-m",
      "https://cdn/reel.mp4",
      "--ig-type",
      "REEL",
      "--ig-share-to-story",
      "--ig-collaborator",
      "@ada",
      "--ig-collaborator",
      "grace",
      "--ig-ai-generated",
      "--ig-audio",
      "901",
      "--ig-audio-volume",
      "40",
      "--fb-share-to-story",
      "--dry-run",
    ]);

    expect(stdoutJson().data).toMatchObject({
      instagramConfigs: [
        {
          connectionId: "ig_7c3e",
          postType: "REEL",
          shareToStory: true,
          collaborators: ["ada", "grace"],
          aiGenerated: true,
          audio: { audioId: "901", audioVolume: 40 },
        },
      ],
      facebookConfigs: [{ pageId: "fb_1", shareToStory: true }],
    });
  });

  it("sends the YouTube altered or synthetic content label from --yt-ai-generated", async () => {
    await run([
      "post",
      "create",
      "-t",
      "Launch video",
      "-a",
      "yt_1",
      "-m",
      "https://cdn/launch.mp4",
      "--yt-title",
      "Launch",
      "--yt-ai-generated",
      "--dry-run",
    ]);

    expect(stdoutJson().data).toMatchObject({
      youtubeConfigs: [{ connectionId: "yt_1", videoTitle: "Launch", aiGenerated: true }],
    });
  });

  it("builds a Facebook link carousel from --fb-card, implying the carousel layout", async () => {
    await run([
      "post",
      "create",
      "-t",
      "New arrivals",
      "-a",
      "fb_1",
      "-m",
      "https://cdn/a.png",
      "-m",
      "https://cdn/b.png",
      "--fb-card",
      "https://acme.test/shoes|Shoes|Spring range, 20% off",
      "--fb-card",
      "https://acme.test/bags||Leather | canvas",
      "--dry-run",
    ]);

    expect(stdoutJson().data).toMatchObject({
      facebookConfigs: [
        {
          pageId: "fb_1",
          imageLayout: "CAROUSEL",
          carouselCards: [
            { link: "https://acme.test/shoes", title: "Shoes", description: "Spring range, 20% off" },
            { link: "https://acme.test/bags", description: "Leather | canvas" },
          ],
        },
      ],
    });
  });

  it("sends --fb-layout grid and refuses it next to --fb-card, an unknown layout, or a card with no link", async () => {
    await run(["post", "create", "-t", "Hi", "-a", "fb_1", "-m", "https://cdn/a.png", "--fb-layout", "grid", "--dry-run"]);
    expect(stdoutJson().data).toMatchObject({ facebookConfigs: [{ pageId: "fb_1", imageLayout: "GRID" }] });

    const base = ["post", "create", "-t", "Hi", "-a", "fb_1", "--dry-run"];
    await expect(run([...base, "--fb-layout", "grid", "--fb-card", "https://acme.test"])).rejects.toMatchObject({
      exitCode: 2,
    });
    await expect(run([...base, "--fb-layout", "stack"])).rejects.toMatchObject({ exitCode: 2 });
    await expect(run([...base, "--fb-card", "|Title only"])).rejects.toMatchObject({ exitCode: 2 });
  });

  it("refuses more than 5 Facebook carousel cards", async () => {
    const cards = Array.from({ length: 6 }, (_, index) => ["--fb-card", `https://acme.test/${index}`]).flat();
    await expect(run(["post", "create", "-t", "Hi", "-a", "fb_1", ...cards, "--dry-run"])).rejects.toMatchObject({
      exitCode: 5,
    });
  });

  it("refuses audio details without --ig-audio", async () => {
    await expect(
      run(["post", "create", "-t", "Hi", "-a", "ig_7c3e", "--ig-audio-title", "Sunrise", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  it("sends first comments, per-platform thumbnails, aspect ratios and keep links", async () => {
    await run([
      "post",
      "create",
      "-t",
      "Read more at example.com",
      "-a",
      "tw_4d1b",
      "-a",
      "li_22aa",
      "--first-comment",
      "TWITTER=Thread below = more",
      "--first-comment",
      "li=Questions welcome",
      "--x-keep-links",
      "--dry-run",
    ]);

    expect(stdoutJson().data).toMatchObject({
      twitterKeepLinks: true,
      firstComments: [
        { platform: "TWITTER", text: "Thread below = more" },
        { platform: "LINKEDIN", text: "Questions welcome" },
      ],
    });

    written = [];
    await run([
      "post",
      "create",
      "-t",
      "Clip",
      "-a",
      "ig_7c3e",
      "-a",
      "li_22aa",
      "-m",
      "https://cdn/clip.mp4",
      "--thumbnail-for",
      "LINKEDIN=https://cdn/li.png",
      "--thumbnail-ms-for",
      "INSTAGRAM=2500",
      "--dry-run",
    ]);

    expect(stdoutJson().data).toMatchObject({
      platformThumbnails: [
        { platform: "LINKEDIN", thumbnailUrl: "https://cdn/li.png" },
        { platform: "INSTAGRAM", thumbnailTimestampMs: 2500 },
      ],
    });

    written = [];
    await run([
      "post",
      "create",
      "-t",
      "Photo",
      "-a",
      "ig_7c3e",
      "-m",
      "https://cdn/a.png",
      "--aspect-ratio",
      "INSTAGRAM=portrait",
      "--fit",
      "INSTAGRAM=pad",
      "--dry-run",
    ]);

    expect(stdoutJson().data).toMatchObject({
      platformAspectRatios: [{ platform: "INSTAGRAM", aspectRatio: "PORTRAIT", fit: "PAD" }],
    });
  });

  it("refuses a first comment on a platform without one, and a TELEGRAM target", async () => {
    await expect(
      run(["post", "create", "-t", "Hi", "-a", "ig_7c3e", "--first-comment", "INSTAGRAM=hi", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: 5 });
    await expect(run(["post", "create", "-t", "Hi", "-P", "TELEGRAM", "--dry-run"])).rejects.toMatchObject({
      exitCode: 5,
    });
  });

  it("sends first comments and keep links on update without touching the targets", async () => {
    await run([
      "post",
      "update",
      "post_1",
      "--first-comment",
      "TWITTER=Updated reply",
      "--no-x-keep-links",
      "--dry-run",
    ]);

    expect(stdoutJson().data).toEqual({
      twitterKeepLinks: false,
      firstComments: [{ platform: "TWITTER", text: "Updated reply" }],
    });
  });

  it("resends one Instagram target with shareToStory, collaborators, the AI label and audio when the post has a story sibling", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_1",
      status: "SCHEDULED",
      contentType: "VIDEO",
      text: "Reel",
      timezone: "UTC",
      mediaUrls: ["https://cdn/reel.mp4"],
      platforms: [
        {
          id: "pp_1",
          platform: "INSTAGRAM",
          status: "PENDING",
          connectionId: "ig_7c3e",
          instagramPostType: "REEL",
          instagramCollaborators: ["ada"],
          instagramAiGenerated: true,
          instagramAudioId: "901",
          instagramAudioVolume: 40,
          mediaUrls: [],
          mediaAltTexts: [],
          previewUrls: [],
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "pp_2",
          platform: "INSTAGRAM",
          status: "PENDING",
          connectionId: "ig_7c3e",
          instagramPostType: "STORY",
          mediaUrls: [],
          mediaAltTexts: [],
          previewUrls: [],
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "pp_3",
          platform: "GOOGLE_BUSINESS",
          status: "PENDING",
          connectionId: "gbp_1",
          googleBusinessTopicType: "STANDARD",
          googleBusinessCallToActionType: "CALL",
          mediaUrls: [],
          mediaAltTexts: [],
          previewUrls: [],
          createdAt: "",
          updatedAt: "",
        },
      ],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

    await run(["post", "update", "post_1", "--alt", "A reel", "--dry-run"]);

    expect(stdoutJson().data).toEqual({
      mediaAltTexts: ["A reel"],
      platforms: ["INSTAGRAM", "GOOGLE_BUSINESS"],
      instagramConnectionIds: ["ig_7c3e"],
      instagramConfigs: [
        {
          connectionId: "ig_7c3e",
          postType: "REEL",
          collaborators: ["ada"],
          aiGenerated: true,
          audio: { audioId: "901", audioVolume: 40 },
          shareToStory: true,
        },
      ],
      googleBusinessConnectionIds: ["gbp_1"],
      googleBusinessConfigs: [{ connectionId: "gbp_1", topicType: "STANDARD", callToActionType: "CALL" }],
    });
  });

  it("resends the YouTube altered or synthetic content label a post already has", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_1",
      status: "SCHEDULED",
      contentType: "VIDEO",
      text: "Launch video",
      timezone: "UTC",
      mediaUrls: ["https://cdn/launch.mp4"],
      platforms: [
        {
          id: "pp_1",
          platform: "YOUTUBE",
          status: "PENDING",
          connectionId: "yt_1",
          youtubeVideoTitle: "Launch",
          youtubeMadeForKids: false,
          youtubeAiGenerated: true,
          mediaUrls: [],
          mediaAltTexts: [],
          previewUrls: [],
          createdAt: "",
          updatedAt: "",
        },
      ],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

    await run(["post", "update", "post_1", "--alt", "Launch", "--dry-run"]);

    expect(stdoutJson().data).toMatchObject({
      platforms: ["YOUTUBE"],
      youtubeConnectionIds: ["yt_1"],
      youtubeConfigs: [{ connectionId: "yt_1", videoTitle: "Launch", madeForKids: false, aiGenerated: true }],
    });
  });

  it("resends a Facebook carousel layout and its cards", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_1",
      status: "SCHEDULED",
      contentType: "CAROUSEL",
      text: "New arrivals",
      timezone: "UTC",
      mediaUrls: ["https://cdn/a.png", "https://cdn/b.png"],
      platforms: [
        {
          id: "pp_1",
          platform: "FACEBOOK",
          status: "PENDING",
          pageId: "fb_1",
          facebookPostType: "FEED",
          facebookImageLayout: "CAROUSEL",
          facebookCarouselCards: [{ link: "https://acme.test/shoes", title: "Shoes" }, { link: "https://acme.test/bags" }],
          mediaUrls: [],
          mediaAltTexts: [],
          previewUrls: [],
          createdAt: "",
          updatedAt: "",
        },
      ],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

    await run(["post", "update", "post_1", "--alt", "Shoes", "--dry-run"]);

    expect(stdoutJson().data).toMatchObject({
      platforms: ["FACEBOOK"],
      facebookConfigs: [
        {
          pageId: "fb_1",
          postType: "FEED",
          imageLayout: "CAROUSEL",
          carouselCards: [{ link: "https://acme.test/shoes", title: "Shoes" }, { link: "https://acme.test/bags" }],
        },
      ],
    });
  });

  it("creates a Pinterest post without --pinterest-board and sends the board when the flag is set", async () => {
    vi.mocked(client.listSocialAccounts).mockResolvedValue({
      accounts: [
        ...accounts,
        { id: "pin_3c1d", platform: "PINTEREST", displayName: "Acme", username: "acme", avatarUrl: "", status: "active" },
      ],
    });
    const create = ["post", "create", "-t", "Pin", "-a", "pin_3c1d", "-m", "https://cdn/a.png", "--dry-run"];

    await run(create);

    expect(stdoutJson().data).toMatchObject({ platforms: ["PINTEREST"], pinterestConnectionIds: ["pin_3c1d"] });
    expect(stdoutJson().data).not.toHaveProperty("pinterestConfigs");

    written = [];
    await run([...create, "--pinterest-board", "549755885175"]);

    expect(stdoutJson().data).toMatchObject({
      pinterestConfigs: [{ connectionId: "pin_3c1d", boardId: "549755885175" }],
    });
  });

  it("resends a Pinterest title and link when the post has no board", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_1",
      status: "SCHEDULED",
      contentType: "IMAGE",
      text: "Pin",
      timezone: "UTC",
      mediaUrls: ["https://cdn/a.png"],
      platforms: [
        {
          id: "pp_1",
          platform: "PINTEREST",
          status: "PENDING",
          connectionId: "pin_3c1d",
          pinterestTitle: "Recipe",
          pinterestLink: "https://acme.example/recipe",
          mediaUrls: [],
          mediaAltTexts: [],
          previewUrls: [],
          createdAt: "",
          updatedAt: "",
        },
      ],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

    await run(["post", "update", "post_1", "--alt", "A photo", "--dry-run"]);

    expect(stdoutJson().data).toEqual({
      mediaAltTexts: ["A photo"],
      platforms: ["PINTEREST"],
      pinterestConnectionIds: ["pin_3c1d"],
      pinterestConfigs: [{ connectionId: "pin_3c1d", title: "Recipe", link: "https://acme.example/recipe" }],
    });
  });

  it("refuses to resend the targets of a post that also goes to Telegram", async () => {
    vi.mocked(client.getPost).mockResolvedValue({
      id: "post_1",
      status: "SCHEDULED",
      contentType: "IMAGE",
      timezone: "UTC",
      mediaUrls: ["https://cdn/a.png"],
      platforms: [
        { id: "pp_1", platform: "TWITTER", status: "PENDING", connectionId: "tw_4d1b", mediaUrls: [], mediaAltTexts: [], previewUrls: [], createdAt: "", updatedAt: "" },
        { id: "pp_2", platform: "TELEGRAM", status: "PENDING", connectionId: "tg_1", mediaUrls: [], mediaAltTexts: [], previewUrls: [], createdAt: "", updatedAt: "" },
      ],
      createdAt: "",
      updatedAt: "",
      userId: "u",
    });

    await expect(run(["post", "update", "post_1", "--alt", "A photo", "--dry-run"])).rejects.toMatchObject({
      exitCode: 5,
      message: expect.stringContaining("TELEGRAM"),
    });
  });

  it("reads the per-platform CSV columns into each bulk item and GOOGLE_BUSINESS configs into the batch", async () => {
    const path = csvPath(
      [
        "text,scheduledAt,media,firstComment_TWITTER,aspectRatio_INSTAGRAM,fit_INSTAGRAM,text_GOOGLE_BUSINESS,config_GOOGLE_BUSINESS",
        'Photo,2026-10-19T09:00:00Z,https://cdn/a.png,"Reply, with a comma",square,pad,Shorter,"{""topicType"":""STANDARD"",""callToActionType"":""CALL""}"',
        "",
      ].join("\n"),
    );

    await run(["post", "bulk", "--csv", path, "-a", "tw_4d1b", "-a", "ig_7c3e", "-a", "gbp_1", "--dry-run"]);

    const [batch] = stdoutJson().data as Record<string, unknown>[];
    expect(batch).toMatchObject({
      platforms: ["TWITTER", "INSTAGRAM", "GOOGLE_BUSINESS"],
      googleBusinessConnectionIds: ["gbp_1"],
      googleBusinessConfigs: [{ connectionId: "gbp_1", topicType: "STANDARD", callToActionType: "CALL" }],
    });
    expect((batch?.posts as Record<string, unknown>[])[0]).toMatchObject({
      platformTexts: [{ platform: "GOOGLE_BUSINESS", text: "Shorter" }],
      firstComments: [{ platform: "TWITTER", text: "Reply, with a comma" }],
      platformAspectRatios: [{ platform: "INSTAGRAM", aspectRatio: "SQUARE", fit: "PAD" }],
    });
  });

  it("reads a Facebook carousel from a config_FACEBOOK column", async () => {
    const path = csvPath(
      [
        "text,scheduledAt,media,config_FACEBOOK",
        'Arrivals,2026-10-19T09:00:00Z,https://cdn/a.png;https://cdn/b.png,"{""carouselCards"":[{""link"":""https://acme.test/a""},{""link"":""https://acme.test/b"",""title"":""Bags""}]}"',
        "",
      ].join("\n"),
    );

    await run(["post", "bulk", "--csv", path, "-a", "fb_1", "--dry-run"]);

    const [batch] = stdoutJson().data as Record<string, unknown>[];
    expect(batch).toMatchObject({
      facebookConfigs: [
        {
          pageId: "fb_1",
          imageLayout: "CAROUSEL",
          carouselCards: [{ link: "https://acme.test/a" }, { link: "https://acme.test/b", title: "Bags" }],
        },
      ],
    });
  });

  it("refuses a bulk row whose per-platform column the API would reject, with its row number", async () => {
    const path = csvPath(
      ["text,scheduledAt,thumbnail_TIKTOK", "Clip,2026-10-19T09:00:00Z,https://cdn/t.png", ""].join("\n"),
    );

    await expect(run(["post", "bulk", "--csv", path, "-P", "TIKTOK", "--dry-run"])).rejects.toMatchObject({
      exitCode: 5,
      message: expect.stringContaining("Row 2"),
    });
  });

  it("reads first comments from --dir files and refuses keepLinks there", async () => {
    const dir = mkdtempSync(join(workspace, "posts-"));
    writeFileSync(
      join(dir, "01.md"),
      ["---", "at: 2026-10-19T09:00:00Z", "linkedin:", "  firstComment: Slides in the comments", "---", "Talk", ""].join("\n"),
    );

    await run(["post", "bulk", "--dir", dir, "-P", "LINKEDIN", "--dry-run"]);

    const [batch] = stdoutJson().data as { posts: Record<string, unknown>[] }[];
    expect(batch?.posts[0]).toMatchObject({
      firstComments: [{ platform: "LINKEDIN", text: "Slides in the comments" }],
    });

    writeFileSync(
      join(dir, "02.md"),
      ["---", "at: 2026-10-20T09:00:00Z", "twitter:", "  keepLinks: true", "---", "example.com", ""].join("\n"),
    );
    await expect(run(["post", "bulk", "--dir", dir, "-P", "TWITTER", "--dry-run"])).rejects.toMatchObject({
      exitCode: 5,
      message: expect.stringContaining("02.md"),
    });
  });
});

describe("Pinterest boards by name", () => {
  const pinterest: SocialAccount = {
    id: "pin_3c1d",
    platform: "PINTEREST",
    displayName: "Acme",
    username: "acme",
    avatarUrl: "",
    status: "active",
  };
  const create = ["post", "create", "-t", "Pin", "-a", "pin_3c1d", "-m", "https://cdn/a.png"];

  beforeEach(() => {
    vi.mocked(client.listSocialAccounts).mockResolvedValue({ accounts: [...accounts, pinterest] });
    vi.mocked(client.listPinterestBoards).mockResolvedValue({
      boards: [
        { id: "549755885175", name: "Small Living Room Ideas" },
        { id: "549755885176", name: "Patio" },
        { id: "549755885177", name: "patio" },
        { id: "549755885178", name: "Kitchen" },
        { id: "549755885179", name: "KITCHEN" },
      ],
    });
  });

  it("sends the name and shows the board it resolves to on a dry run", async () => {
    await run([...create, "--pinterest-board-name", "small living room ideas", "--dry-run"]);

    expect(client.listPinterestBoards).toHaveBeenCalledWith("pin_3c1d");
    expect(stdoutJson()).toMatchObject({
      data: { pinterestConfigs: [{ connectionId: "pin_3c1d", boardName: "small living room ideas" }] },
      meta: {
        dryRun: true,
        pinterestBoards: [
          {
            connectionId: "pin_3c1d",
            boardName: "small living room ideas",
            boardId: "549755885175",
            resolvedName: "Small Living Room Ideas",
          },
        ],
      },
    });
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("leaves the name to the API on a real run", async () => {
    vi.mocked(client.createPost).mockResolvedValue({ postId: "post_9", queuedPlatforms: ["PINTEREST"] } as never);

    await run([...create, "--pinterest-board-name", "Small Living Room Ideas"]);

    expect(client.listPinterestBoards).not.toHaveBeenCalled();
    expect(client.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        pinterestConfigs: [{ connectionId: "pin_3c1d", boardName: "Small Living Room Ideas" }],
      }),
    );
  });

  it("refuses a missing or shared name on a dry run without falling back to another board", async () => {
    await expect(run([...create, "--pinterest-board-name", "Bathroom", "--dry-run"])).rejects.toMatchObject({
      exitCode: 5,
      message: 'No board named "Bathroom" on this Pinterest account.',
    });
    await expect(run([...create, "--pinterest-board-name", " kitchen ", "--dry-run"])).rejects.toMatchObject({
      exitCode: 5,
      message: expect.stringContaining("549755885178, 549755885179"),
    });
    await run([...create, "--pinterest-board-name", "Patio", "--dry-run"]);
    expect(stdoutJson()).toMatchObject({ meta: { pinterestBoards: [{ boardId: "549755885176" }] } });
  });

  it("refuses a board id and a board name together, from flags or from a config", async () => {
    await expect(
      run([...create, "--pinterest-board", "549755885175", "--pinterest-board-name", "Patio", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: 5, message: "Pass --pinterest-board or --pinterest-board-name, not both." });

    await expect(
      run([...create, "--config", 'PINTEREST={"boardId":"549755885175","boardName":"Patio"}', "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: 5, message: "Pass boardId or boardName for a Pinterest account, not both." });
    expect(client.listPinterestBoards).not.toHaveBeenCalled();
  });

  it("lets a flag replace the board a file names", async () => {
    const file = join(workspace, "pin.md");
    writeFileSync(
      file,
      ["---", "accounts: [pin_3c1d]", "media: [https://cdn/a.png]", "pinterest:", "  boardId: \"549755885176\"", "---", "Pin", ""].join(
        "\n",
      ),
    );

    await run(["post", "create", "--file", file, "--pinterest-board-name", "Small Living Room Ideas", "--dry-run"]);

    expect(stdoutJson()).toMatchObject({
      data: { pinterestConfigs: [{ connectionId: "pin_3c1d", boardName: "Small Living Room Ideas" }] },
    });
    expect((stdoutJson().data as { pinterestConfigs: object[] }).pinterestConfigs[0]).not.toHaveProperty("boardId");
  });

  it("resolves the name on post update with the account", async () => {
    await run(["post", "update", "post_1", "-a", "pin_3c1d", "--pinterest-board-name", "Patio", "--dry-run"]);

    expect(stdoutJson()).toMatchObject({
      data: { pinterestConfigs: [{ connectionId: "pin_3c1d", boardName: "Patio" }] },
      meta: { pinterestBoards: [{ boardId: "549755885176", resolvedName: "Patio" }] },
    });
    expect(client.updatePost).not.toHaveBeenCalled();
  });

  it("resolves boardName from a bulk CSV config column once per account", async () => {
    const path = join(workspace, "pins.csv");
    writeFileSync(
      path,
      [
        "text,scheduledAt,media,config_PINTEREST",
        'One,2026-10-19T09:00:00Z,https://cdn/a.png,"{""boardName"":""Patio""}"',
        'Two,2026-10-20T09:00:00Z,https://cdn/b.png,"{""boardName"":""Patio""}"',
        "",
      ].join("\n"),
    );

    await run(["post", "bulk", "--csv", path, "-a", "pin_3c1d", "--dry-run"]);

    expect(client.listPinterestBoards).toHaveBeenCalledTimes(1);
    expect(stdoutJson()).toMatchObject({
      data: [{ pinterestConfigs: [{ connectionId: "pin_3c1d", boardName: "Patio" }] }],
      meta: { pinterestBoards: [{ connectionId: "pin_3c1d", boardName: "Patio", boardId: "549755885176" }] },
    });
  });

  it("checks the names in a bulk JSON file on a dry run", async () => {
    const path = join(workspace, "pins.json");
    writeFileSync(
      path,
      JSON.stringify({
        platforms: ["PINTEREST"],
        pinterestConnectionIds: ["pin_3c1d"],
        posts: [
          {
            contentType: "IMAGE",
            scheduledAt: "2026-10-19T09:00:00Z",
            mediaUrls: ["https://cdn/a.png"],
            pinterestConfigs: [{ connectionId: "pin_3c1d", boardName: "Bathroom" }],
          },
        ],
      }),
    );

    await expect(run(["post", "bulk", "--json-file", path, "--dry-run"])).rejects.toMatchObject({
      exitCode: 5,
      message: 'No board named "Bathroom" on this Pinterest account.',
    });
  });
});
