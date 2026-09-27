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
