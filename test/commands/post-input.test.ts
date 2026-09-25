import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ExitCode } from "../../src/core/exit-codes.js";
import type { SocialAccount } from "../../src/api/types.js";
import {
  buildPostBody,
  buildTargets,
  inferContentType,
  inspectLocalMedia,
  mergePostInput,
  parseFrontmatter,
  parsePostInput,
  parseScalar,
  sniffMimeType,
} from "../../src/commands/post-input.js";

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
    id: "fb_page_91c",
    platform: "FACEBOOK",
    displayName: "Acme Page",
    username: "",
    avatarUrl: "",
    status: "active",
    pageId: "102938",
  },
  {
    id: "tt_77aa",
    platform: "TIKTOK",
    displayName: "Acme",
    username: "acme",
    avatarUrl: "",
    status: "active",
  },
];

const exitCodeOf = (run: () => unknown): number => {
  try {
    run();
  } catch (error) {
    return (error as { exitCode: number }).exitCode;
  }
  throw new Error("expected a throw");
};

describe("parseScalar", () => {
  it("reads quoted strings, numbers, booleans and null", () => {
    expect(parseScalar('"hello world"')).toBe("hello world");
    expect(parseScalar("'it''s here'")).toBe("it's here");
    expect(parseScalar("42")).toBe(42);
    expect(parseScalar("-1.5")).toBe(-1.5);
    expect(parseScalar("true")).toBe(true);
    expect(parseScalar("no")).toBe(false);
    expect(parseScalar("~")).toBeNull();
  });

  it("keeps ISO dates as strings", () => {
    expect(parseScalar("2026-09-20T09:00:00Z")).toBe("2026-09-20T09:00:00Z");
    expect(parseScalar("2026-09-20")).toBe("2026-09-20");
  });

  it("reads inline arrays", () => {
    expect(parseScalar("[TWITTER, LINKEDIN]")).toEqual(["TWITTER", "LINKEDIN"]);
    expect(parseScalar('["a, b", 3]')).toEqual(["a, b", 3]);
  });

  it("drops trailing comments outside quotes", () => {
    expect(parseScalar("acme.com # the site")).toBe("acme.com");
    expect(parseScalar('"acme # one"')).toBe("acme # one");
  });
});

describe("parseFrontmatter", () => {
  it("returns the whole source as the body when there is no frontmatter", () => {
    const { data, body } = parseFrontmatter("Just text.\n");
    expect(data).toEqual({});
    expect(body).toBe("Just text.\n");
  });

  it("reads dash lists, nested maps and block scalars", () => {
    const source = [
      "---",
      "platforms:",
      "  - TWITTER",
      "  - LINKEDIN",
      "count: 3",
      "linkedin:",
      "  text: |",
      "    first line",
      "    second line",
      "  visibility: PUBLIC",
      "---",
      "Body text.",
      "",
    ].join("\n");

    const { data, body } = parseFrontmatter(source);

    expect(data.platforms).toEqual(["TWITTER", "LINKEDIN"]);
    expect(data.count).toBe(3);
    expect(data.linkedin).toEqual({
      text: "first line\nsecond line\n",
      visibility: "PUBLIC",
    });
    expect(body.trim()).toBe("Body text.");
  });

  it("refuses frontmatter that is never closed", () => {
    expect(exitCodeOf(() => parseFrontmatter("---\nplatforms: [TWITTER]\nno end"))).toBe(
      ExitCode.VALIDATION,
    );
  });
});

describe("parsePostInput", () => {
  const source = [
    "---",
    "platforms: [TWITTER, LINKEDIN]",
    "accounts: [tw_4d1b, li_22aa]",
    "at: 2026-09-20T09:00:00Z",
    "timezone: Europe/Berlin",
    "media: [./hero.png]",
    "linkedin:",
    "  text: |",
    "    A longer version for LinkedIn.",
    "---",
    "Shipping the CLI today.",
    "",
  ].join("\n");

  it("maps frontmatter onto the post input and takes the body as text", () => {
    const input = parsePostInput(source);

    expect(input.platforms).toEqual(["TWITTER", "LINKEDIN"]);
    expect(input.accounts).toEqual(["tw_4d1b", "li_22aa"]);
    expect(input.at).toBe("2026-09-20T09:00:00Z");
    expect(input.timezone).toBe("Europe/Berlin");
    expect(input.media).toEqual(["./hero.png"]);
    expect(input.text).toBe("Shipping the CLI today.");
    expect(input.platformTexts?.LINKEDIN).toBe("A longer version for LinkedIn.\n");
  });

  it("keeps each alt text whole, commas included", () => {
    const input = parsePostInput(
      ["---", "media: [./a.png, ./b.png]", 'alt: ["A red bike, parked", "A blue door"]', "---", "Body"].join("\n"),
    );

    expect(input.alt).toEqual(["A red bike, parked", "A blue door"]);
  });

  it("turns the non-text keys of a platform block into its config", () => {
    const input = parsePostInput(
      ["---", "tiktok:", "  privacyLevel: SELF_ONLY", "  title: Demo", "---", "Body"].join("\n"),
    );

    expect(input.platformConfigs?.TIKTOK).toEqual({ privacyLevel: "SELF_ONLY", title: "Demo" });
  });

  it("maps every document title alias onto the LinkedIn config", () => {
    for (const key of ["documentTitle", "document-title", "document_title", "linkedinDocumentTitle"]) {
      const input = parsePostInput(["---", `${key}: Q3 results`, "---", "Body"].join("\n"));
      expect(input.platformConfigs?.LINKEDIN).toEqual({ documentTitle: "Q3 results" });
    }
  });

  it("merges the document title key with a linkedin block, in either order", () => {
    const before = parsePostInput(
      ["---", "documentTitle: Deck", "linkedin:", "  text: Long", "  other: 1", "---", "Body"].join("\n"),
    );
    const after = parsePostInput(
      ["---", "linkedin:", "  documentTitle: Block", "type: DOCUMENT", "document-title: Deck", "---", "Body"].join("\n"),
    );

    expect(before.platformConfigs?.LINKEDIN).toEqual({ documentTitle: "Deck", other: 1 });
    expect(before.platformTexts?.LINKEDIN).toBe("Long");
    expect(after.platformConfigs?.LINKEDIN).toEqual({ documentTitle: "Deck" });
    expect(after.contentType).toBe("DOCUMENT");
  });

  it("refuses an unknown frontmatter key", () => {
    expect(exitCodeOf(() => parsePostInput("---\nnonsense: 1\n---\nBody"))).toBe(
      ExitCode.VALIDATION,
    );
  });

  it("refuses an unknown platform", () => {
    expect(exitCodeOf(() => parsePostInput("---\nplatforms: [MYSPACE]\n---\nBody"))).toBe(
      ExitCode.USAGE,
    );
  });
});

describe("mergePostInput", () => {
  it("lets the override win and merges the per-platform maps", () => {
    const merged = mergePostInput(
      {
        text: "from file",
        platforms: ["TWITTER"],
        platformTexts: { TWITTER: "a", LINKEDIN: "b" },
        platformConfigs: { TIKTOK: { privacyLevel: "SELF_ONLY" } },
      },
      {
        text: "from flag",
        platformTexts: { TWITTER: "c" },
        platformConfigs: { TIKTOK: { title: "Demo" } },
      },
    );

    expect(merged.text).toBe("from flag");
    expect(merged.platforms).toEqual(["TWITTER"]);
    expect(merged.platformTexts).toEqual({ TWITTER: "c", LINKEDIN: "b" });
    expect(merged.platformConfigs?.TIKTOK).toEqual({ privacyLevel: "SELF_ONLY", title: "Demo" });
  });
});

describe("buildPostBody", () => {
  it("routes each account id into the array for its platform", () => {
    const body = buildPostBody(
      {
        text: "hello",
        platforms: ["TWITTER", "LINKEDIN"],
        accounts: ["tw_4d1b", "li_22aa"],
        timezone: "Europe/Berlin",
      },
      { accounts },
    );

    expect(body.twitterConnectionIds).toEqual(["tw_4d1b"]);
    expect(body.linkedinConnectionIds).toEqual(["li_22aa"]);
    expect(body.contentType).toBe("TEXT");
    expect(body.timezone).toBe("Europe/Berlin");
  });

  it("sends alt texts only when the post has media", () => {
    const withMedia = buildPostBody(
      { text: "hello", accounts: ["tw_4d1b"], alt: ["A red bike"] },
      { accounts, mediaUrls: ["https://cdn.example.com/a.jpg"] },
    );
    const withoutMedia = buildPostBody({ text: "hello", accounts: ["tw_4d1b"], alt: ["A red bike"] }, { accounts });

    expect(withMedia.mediaAltTexts).toEqual(["A red bike"]);
    expect(withoutMedia.mediaAltTexts).toBeUndefined();
  });

  it("routes a Facebook page by its page id into pageIds", () => {
    const body = buildPostBody(
      { text: "hello", accounts: ["102938"] },
      { accounts },
    );

    expect(body.pageIds).toEqual(["fb_page_91c"]);
    expect(body.platforms).toEqual(["FACEBOOK"]);
  });

  it("fails with exit 4 on an account that is not in the workspace", () => {
    expect(
      exitCodeOf(() => buildPostBody({ text: "hello", accounts: ["nope"] }, { accounts })),
    ).toBe(ExitCode.NOT_FOUND);
  });

  it("infers the content type from the media", () => {
    const body = buildPostBody(
      { text: "hi", platforms: ["TWITTER"], accounts: ["tw_4d1b"] },
      { accounts, mediaUrls: ["https://cdn/one.jpg", "https://cdn/two.jpg"] },
    );

    expect(body.contentType).toBe("CAROUSEL");
    expect(body.mediaUrls).toHaveLength(2);
  });

  it("writes platform texts as an array", () => {
    const body = buildPostBody(
      {
        text: "hi",
        platforms: ["TWITTER"],
        accounts: ["tw_4d1b"],
        platformTexts: { TWITTER: "short" },
      },
      { accounts },
    );

    expect(body.platformTexts).toEqual([{ platform: "TWITTER", text: "short" }]);
  });

  it("builds one config entry per connection of that platform", () => {
    const body = buildPostBody(
      {
        text: "hi",
        accounts: ["tt_77aa"],
        platformConfigs: { TIKTOK: { privacyLevel: "SELF_ONLY" } },
      },
      { accounts },
    );

    expect(body.tiktokConfigs).toEqual([
      { connectionId: "tt_77aa", privacyLevel: "SELF_ONLY" },
    ]);
  });

  it("infers DOCUMENT from one document file and builds linkedinConfigs", () => {
    const body = buildPostBody(
      {
        text: "Our Q3 report",
        accounts: ["li_22aa"],
        platformConfigs: { LINKEDIN: { documentTitle: "Q3 report" } },
      },
      { accounts, mediaUrls: ["https://cdn.example.com/q3.pdf"] },
    );

    expect(body.contentType).toBe("DOCUMENT");
    expect(body.platforms).toEqual(["LINKEDIN"]);
    expect(body.linkedinConfigs).toEqual([{ connectionId: "li_22aa", documentTitle: "Q3 report" }]);
  });

  it("refuses DOCUMENT on any platform but LinkedIn", () => {
    expect(
      exitCodeOf(() =>
        buildPostBody(
          { text: "hi", accounts: ["li_22aa", "tw_4d1b"], contentType: "DOCUMENT" },
          { accounts, mediaUrls: ["https://cdn.example.com/q3.pdf"] },
        ),
      ),
    ).toBe(ExitCode.VALIDATION);
  });

  it("refuses DOCUMENT with two files or with an image", () => {
    const post = (mediaUrls: string[]): number =>
      exitCodeOf(() =>
        buildPostBody({ text: "hi", accounts: ["li_22aa"], contentType: "DOCUMENT" }, { accounts, mediaUrls }),
      );

    expect(post(["https://cdn/a.pdf", "https://cdn/b.pdf"])).toBe(ExitCode.VALIDATION);
    expect(post(["https://cdn/a.jpg"])).toBe(ExitCode.VALIDATION);
    expect(post([])).toBe(ExitCode.VALIDATION);
  });

  it("refuses a document file on a post that is not DOCUMENT", () => {
    expect(
      exitCodeOf(() =>
        buildPostBody(
          { text: "hi", accounts: ["li_22aa"], contentType: "IMAGE" },
          { accounts, mediaUrls: ["https://cdn/a.pptx"] },
        ),
      ),
    ).toBe(ExitCode.VALIDATION);
  });

  it("refuses a LinkedIn document title over 100 characters", () => {
    expect(
      exitCodeOf(() =>
        buildPostBody(
          {
            text: "hi",
            accounts: ["li_22aa"],
            platformConfigs: { LINKEDIN: { documentTitle: "x".repeat(101) } },
          },
          { accounts, mediaUrls: ["https://cdn/a.pdf"] },
        ),
      ),
    ).toBe(ExitCode.VALIDATION);
  });

  it("refuses TikTok without a privacy level, unless it is a draft", () => {
    expect(
      exitCodeOf(() => buildPostBody({ text: "hi", accounts: ["tt_77aa"] }, { accounts })),
    ).toBe(ExitCode.VALIDATION);

    expect(
      buildPostBody({ text: "hi", accounts: ["tt_77aa"], draft: true }, { accounts }).saveAsDraft,
    ).toBe(true);
  });

  it("refuses a post with neither text nor media", () => {
    expect(
      exitCodeOf(() => buildPostBody({ platforms: ["TWITTER"], accounts: ["tw_4d1b"] }, { accounts })),
    ).toBe(ExitCode.VALIDATION);
  });

  it("refuses a post with no platform at all", () => {
    expect(exitCodeOf(() => buildPostBody({ text: "hi" }, { accounts }))).toBe(ExitCode.USAGE);
  });
});

describe("buildTargets", () => {
  it("returns the platforms and the routed target fields", () => {
    const { platforms, targets } = buildTargets(
      { platforms: ["TWITTER"], accounts: ["tw_4d1b", "fb_page_91c"] },
      accounts,
    );

    expect(platforms).toEqual(["TWITTER", "FACEBOOK"]);
    expect(targets).toEqual({
      twitterConnectionIds: ["tw_4d1b"],
      pageIds: ["fb_page_91c"],
    });
  });
});

describe("sniffMimeType", () => {
  const head = (bytes: number[]): Buffer => Buffer.from([...bytes, ...new Array(12).fill(0)]).subarray(0, 12);

  it("reads the signature rather than the extension", () => {
    expect(sniffMimeType(head([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMimeType(head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(
      sniffMimeType(
        Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]),
      ),
    ).toBe("image/webp");
    expect(
      sniffMimeType(Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypisom")])),
    ).toBe("video/mp4");
    expect(
      sniffMimeType(Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypqt  ")])),
    ).toBe("video/quicktime");
    expect(sniffMimeType(head([0x25, 0x50, 0x44, 0x46]))).toBeUndefined();
  });
});

describe("inferContentType", () => {
  it("maps the media count and kind onto a content type", () => {
    expect(inferContentType(0, [])).toBe("TEXT");
    expect(inferContentType(1, ["image/png"])).toBe("IMAGE");
    expect(inferContentType(1, ["video/mp4"])).toBe("VIDEO");
    expect(inferContentType(3, ["image/png"])).toBe("CAROUSEL");
    expect(inferContentType(1, ["application/pdf"])).toBe("DOCUMENT");
    expect(
      inferContentType(1, ["application/vnd.openxmlformats-officedocument.presentationml.presentation"]),
    ).toBe("DOCUMENT");
  });
});

describe("inspectLocalMedia", () => {
  const dir = mkdtempSync(join(tmpdir(), "adaptlypost-cli-media-"));
  const file = (name: string, bytes: Buffer): string => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  };
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);

  it("sniffs a PDF and gives an extensionless one a .pdf upload name", async () => {
    const media = await inspectLocalMedia(file("report", Buffer.from("%PDF-1.7\n%...")));

    expect(media.mimeType).toBe("application/pdf");
    expect(media.fileName).toBe("report.pdf");
  });

  it("types a ZIP by its .docx extension", async () => {
    const media = await inspectLocalMedia(file("notes.docx", zip));

    expect(media.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(media.fileName).toBe("notes.docx");
  });

  it("refuses a ZIP whose name does not say DOCX or PPTX", async () => {
    await expect(inspectLocalMedia(file("bundle.zip", zip))).rejects.toMatchObject({
      exitCode: ExitCode.VALIDATION,
    });
  });
});
