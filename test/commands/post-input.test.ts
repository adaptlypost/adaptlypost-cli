import { describe, expect, it } from "vitest";

import { ExitCode } from "../../src/core/exit-codes.js";
import type { SocialAccount } from "../../src/api/types.js";
import {
  buildPostBody,
  buildTargets,
  inferContentType,
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
  });
});
