# AdaptlyPost CLI

Schedule, publish and measure social posts, and answer comments, messages and reviews, from your terminal.

`adaptlypost` talks to the AdaptlyPost REST API and nothing else. It writes posts from markdown files or stdin, uploads media over presigned URLs, watches a post until every platform reports back, bulk-schedules a month from a CSV, and prints everything as a table for humans or as one JSON document for `jq`.

Runs on Node 22.12 or newer. Also ships as a standalone binary with no Node requirement.

## Install

```bash
# npm, the usual path
npm install -g @adaptlypost/cli

# or run it without installing
npx -p @adaptlypost/cli adaptlypost --help

# macOS and Linux, standalone binary, no Node required
brew trust adaptlypost/tap && brew install adaptlypost/tap/adaptlypost

# or
curl -fsSL https://adaptlypost.com/install.sh | sh
```

`npx @adaptlypost/cli` prompts instead of running, because npx resolves a bin named after the unscoped package. Use `npx -p @adaptlypost/cli adaptlypost`. There is no unscoped `adaptlypost` package, so plain `npx adaptlypost` will not find anything.

Homebrew 7 refuses to load a formula from a third-party tap until you trust it, which is
what `brew trust` does. Skip it and both `brew install` and `brew upgrade` stop with
"Refusing to load formula ... from untrusted tap".

The install script downloads the release archive for your platform, verifies its checksum, and puts the binary in `~/.local/bin`. It never edits your shell rc files; it prints the `export PATH` line for you to add. Override the destination with `ADAPTLYPOST_INSTALL_DIR`.

Both bins run the same program. `apost` is the short one.

## Authentication

Create an API token at <https://adaptlypost.com/api-tokens> and hand it to `login`:

```bash
adaptlypost login
```

The command opens the token page, reads the token from a hidden prompt, checks the `adaptly_` prefix locally, verifies it with one `GET /social-accounts`, and writes it to `~/.config/adaptlypost/credentials.json` at mode 0600. Nothing is written if verification fails.

For CI, pipe the token in and skip the prompt:

```bash
echo "$ADAPTLYPOST_TOKEN" | adaptlypost login --token-stdin --profile ci
```

Or skip `login` entirely and export `ADAPTLYPOST_API_TOKEN`. The CLI reads it on every command.

There is no OAuth or device-code flow yet.

`whoami` calls `GET /me` and prints the workspace the key belongs to, its role, and whether it can draft, schedule and publish:

```
$ adaptlypost whoami
  profile    default
  token      adaptly_4f2a… ("CI deploy", from credentials file)
  api        https://post.adaptlypost.com/post/api/v1
  workspace  ws_9c3e1f
  role       Contributor (contributor, key issued by admin)
  can        draft
  accounts   7 connected accounts, 4 platforms
  limits     598 of 600 requests left this minute
  This key can save drafts but cannot schedule or publish. Ask a workspace admin for a key with the editor or admin role if it should.
```

Under `--json` the `data` object carries `workspace`, `role`, `issuerRole`, `permissions`, `can` and `expiresAt` as the API returns them, plus the account count.

`logout` removes the profile from the credentials file. It does not revoke the token; do that in the dashboard.

## Roles

Every API key is issued under a workspace role, chosen when the key is created, and can never do more than the member who created it. The CLI sends the key; the API decides.

| Role | Can |
|---|---|
| Admin | Everything, including connecting and disconnecting accounts, connect links and account checks |
| Editor | Create, schedule, publish, retry, bulk schedule and delete posts, edit teammates' posts, manage webhooks and the signature, upload media, use AI |
| Contributor | Create and edit its own drafts, upload media, use AI. Cannot schedule, publish, retry, bulk schedule, or touch teammates' posts |
| Viewer | Read posts, accounts and analytics |

When a key's role does not cover a command, the API answers 403 with `code: permission_denied` and the CLI exits 10 with a hint that names the role and the missing permission. When the key's creator has been demoted below the key, the hint names both roles, because the key acts with the creator's. Retrying, or switching to another key of the same role, does not help; ask a workspace admin for a key issued under a higher role. `adaptlypost whoami` shows the role in hand before you try.

A key stops working when the member who created it loses access to the workspace: the API answers 401 with `code: token_issuer_lost_access` and the CLI exits 3. Ask a workspace admin for a new key. A demoted creator shrinks the key to the creator's new permissions.

## Quick start

```
$ adaptlypost login
  Opening https://adaptlypost.com/api-tokens in your browser.
  Create a token, then paste it here.

  Token (starts with adaptly_): ****************************

  ✓ Token valid
    profile    default
    api        https://post.adaptlypost.com/post/api/v1
    accounts   7 connected
    stored in  ~/.config/adaptlypost/credentials.json (0600)
```

```
$ adaptlypost post create -t "Shipping the CLI today." -P TWITTER -P LINKEDIN -a tw_4d1b -a li_22aa --at "+2h"
  ✓ Post created  post_9c3e1f…
    scheduled  2026-09-18 11:41 Europe/Berlin (in 2h)
    queued     TWITTER, LINKEDIN
    watch      adaptlypost post watch post_9c3e1f…
```

```
$ adaptlypost post watch post_9c3e1f
  Watching post_9c3e1f… (2 platforms). Ctrl-C to stop.
  11:41:03  TWITTER    PUBLISHED   https://x.com/acme/status/1836…
  11:41:19  LINKEDIN   FAILED      token expired
  ✓ Finished in 21s · 1 published, 1 failed
```

`watch` exits 0 when every platform published, 1 when any failed, 8 on timeout, so it works as the last step of a deploy script.

## The parts worth the install

**Post from a file or a pipe.** `post create --file launch.md` reads YAML frontmatter for platforms, accounts, schedule, timezone and per-platform overrides, and the markdown body as the post text. Local paths under `media:` are uploaded before the post is created and replaced with their public URLs. `alt:` holds the alt text for each image, in the same order as `media:`. Flags override frontmatter.

```markdown
---
platforms: [TWITTER, LINKEDIN]
accounts: [tw_4d1b, li_22aa]
at: 2026-09-20T09:00:00Z
timezone: Europe/Berlin
media: [./hero.png]
alt: ["The new CLI printing a scheduled post in a dark terminal"]
linkedin:
  text: |
    A longer version for LinkedIn, because the audience is different.
---
Shipping the CLI today. Schedule, publish and check results without
leaving your terminal.
```

A platform block takes the platform's text and config keys plus a few options of its own: `firstComment`, `thread` (see below), `thumbnail` (an image URL), `thumbnailMs` (a video frame), `aspectRatio` with `fit`, `media` with `alt` (the platform's own media, see below), and `keepLinks` in the `twitter:` block. On LinkedIn, mention a company page in the text with `@[Page Name](urn:li:organization:<id>)`, using the page name exactly as LinkedIn shows it. `accounts linkedin-organization <url|vanity>` prints that mention ready to paste. Put it in the `linkedin:` block, or in `--text-for "LINKEDIN=…"`, when the post goes to other platforms too, because they show the syntax as raw text.

```markdown
---
accounts: [tw_4d1b, ig_7c3e, gbp_51e0]
media: [./storefront.png]
twitter:
  firstComment: Opening hours and directions in the replies
instagram:
  aspectRatio: PORTRAIT
  fit: PAD
  collaborators: [acme.bakery]
  userTags:
    - username: ada.bakes
      x: 0.42
      y: 0.61
google_business:
  topicType: EVENT
  eventTitle: Open day
  eventStart: 2026-10-17T10:00
  eventEnd: 2026-10-17T16:00
  callToActionType: LEARN_MORE
  callToActionUrl: https://acme.example/open-day
---
Open day on Saturday. Come and taste the new bread.
```

**Threads.** A `thread:` list in a `twitter:`, `threads:`, `bluesky:` or `mastodon:` block turns the post into a thread on that platform. The post opens it, and each list item goes out from the same account as a reply to the one before, up to 25 replies. An item is either the reply's text, or a block with `text:` and `media:`, a list of up to 4 JPEG, PNG, GIF or WebP images (local files are uploaded first, a GIF has to be an https URL). A reply with images may leave out `text:`. Use `- |` for a reply over several lines. Write a reply that contains ` #` (a hashtag after a space) in quotes or as `- |`, because YAML reads the rest of the line as a comment. A platform can have a thread or a `firstComment`, not both. `threadReplies:` and `replies:` work as names for the list too.

```markdown
---
accounts: [tw_4d1b, bs_19aa]
twitter:
  thread:
    - Here is what changed, in three parts.
    - text: The new upload flow, before and after
      media: [./before.png, ./after.png]
    - media: [https://cdn.acme.example/demo.gif]
    - |
      Release notes: https://acme.example/changelog
      #buildinpublic
bluesky:
  thread:
    - "Shorter on Bluesky. #buildinpublic"
---
We shipped the new upload flow today.
```

A Facebook link carousel takes one card per image, in the same order as `media:`:

```markdown
---
accounts: [fb_1]
media: [./shoes.png, ./bags.png]
facebook:
  imageLayout: CAROUSEL
  carouselCards:
    - link: https://acme.example/shoes
      title: Shoes
      description: The spring range
    - link: https://acme.example/bags
---
New in this week.
```

**One platform, its own media.** When the post media does not fit a platform, such as a video too long for TikTok or more images than X takes, give that platform its own files with `--media-for "PLATFORM=path-or-url"`, one file per flag in order, and `--alt-for "PLATFORM=text"`, one alt text per flag in the same order. Everything after the first `=` is the alt text, commas included, and `--alt-for "PLATFORM="` skips a file. In a file, put `media:` and `alt:` in the platform block, with `alt:` as a YAML list of one item per file and `""` to skip one. Local files are uploaded first. The other platforms keep the post media. The files must fit the post type: one video for VIDEO, one image for IMAGE, one document for DOCUMENT, two or more items for CAROUSEL, and none on a TEXT post. Alt texts go up to 1000 characters each. A platform with its own media skips `--thumbnail` and `--thumbnail-ms`, so give it `--thumbnail-for` or `--thumbnail-ms-for`.

```bash
adaptlypost post create -t "Launch day" -a tt_77aa -a yt_1 -m ./launch-full.mp4 \
  --media-for "TIKTOK=./launch-60s.mp4" --alt-for "TIKTOK=The launch, cut to 60 seconds" \
  --tiktok-privacy PUBLIC_TO_EVERYONE
```

```markdown
---
accounts: [tw_4d1b, ig_7c3e]
media: [./1.png, ./2.png, ./3.png, ./4.png, ./5.png, ./6.png]
twitter:
  media: [./1.png, ./2.png, ./3.png, ./4.png]
  alt:
    - The storefront at dawn, before opening
    - ""
    - Fresh loaves, one with a slice cut
    - The team, waving
---
Six photos from opening week.
```

**LinkedIn document posts.** `--type DOCUMENT` publishes one PDF, PPT, PPTX, DOC or DOCX file (max 100 MB, 300 pages) as a LinkedIn document post. DOCUMENT is LinkedIn only, and `--media` must hold exactly that one file. A single document file with no `--type` is inferred as DOCUMENT. `--document-title` sets the title LinkedIn shows (max 100 characters, defaults to the uploaded file name, ignored for non-DOCUMENT posts); it is sent as `linkedinConfigs` for every LinkedIn account on the post. In frontmatter use `documentTitle:` (or `document-title:`, `linkedinDocumentTitle:`), or `documentTitle` inside a `linkedin:` block.

```bash
adaptlypost post create -t "Our Q3 results" -a li_22aa -m ./q3-report.pdf --document-title "Q3 results"
```

The API reads the document type from the file extension of the stored URL, so the uploaded file name keeps its `.pdf`, `.ppt`, `.pptx`, `.doc` or `.docx` extension; a PDF named without one gets `.pdf` appended. The CLI refuses, before sending, a DOCUMENT post aimed at any other platform ("<platform> does not support DOCUMENT posts"), a DOCUMENT post with two or more files or an image or video ("A document post needs exactly one PDF, PPT, PPTX, DOC or DOCX file in mediaUrls"), and a document file on a post that is not DOCUMENT ("Document files can only be posted with the DOCUMENT content type"), which are the same 400s the API returns.

`-f -` reads the same document from stdin and `-t -` reads plain text. `ai caption` writes the caption alone to stdout, so writing and scheduling a post is one line:

```bash
adaptlypost ai caption --prompt "announce the launch" --platform TWITTER | adaptlypost post create -t - -a tw_4d1b --at "+2h"
```

**Recurring posts.** `post create --repeat DAILY|WEEKLY|MONTHLY|YEARLY` turns the post into a series. `--at` is required and must be in the future. That first post sets the time of day for every post after it, in the zone from `--timezone`. A YEARLY series comes back on the same date every year; one started on February 29 posts on February 28 in other years. `--every 2` repeats every 2 days, weeks, months or years (1 to 30). `--on` picks the weekdays of a WEEKLY repeat, one per flag (`--on MONDAY --on THURSDAY`, or `mon`, `thu`); the weekday of `--at` is always included. End the series with `--until 2026-12-31` (the last day a post may go out) or `--count 10` (2 to 365 posts in total), not both. With neither, it repeats until you pause or delete it. The create output prints the `recurring` id next to the first post's id.

```bash
adaptlypost post create -t "{Hi|Hello}, here is this week's tip" -a tw_4d1b --at "2026-10-05 09:00" --repeat WEEKLY --on mon --on thu --count 12
```

The CLI refuses, before sending, a repeat without `--at`, a repeat on a draft, a TIKTOK account in the series, `--on` on a DAILY, MONTHLY or YEARLY repeat, and an end date before the first post. X and LinkedIn reject identical text, so give those series spintax like `{Hi|Hello}` and each post comes out different. Only the next post of an active series exists as a scheduled post, created about a day ahead. Deleting that one post skips its date and the series carries on. A slot missed while the series is paused is skipped, never published late.

In frontmatter the keys are `repeat:`, `every:`, `on:`, `until:` and `count:`, or their API names `frequency:`, `interval:`, `weekdays:`, `endsOn:` and `maxOccurrences:`. Write weekdays as a YAML list, `on: [MONDAY, THURSDAY]` or one `- MONDAY` per line. A comma-separated string is refused. `post update` and `post bulk --dir` refuse a file with these keys, because only `post create` can start a series.

```markdown
---
accounts: [tw_4d1b]
at: 2026-10-05T09:00:00Z
repeat: WEEKLY
on: [MONDAY, THURSDAY]
until: 2026-12-31
---
{Hi|Hello}, here is this week's tip.
```

**Upload that actually uploads.** `media upload` mints presigned URLs in chunks of 20 and PUTs the bytes with the exact MIME type the presign was signed for, sniffed from the first 12 bytes rather than the extension. A mismatched content type fails the S3 signature with an opaque error, which is the step everyone gets wrong by hand. Accepted: `image/jpeg`, `image/png`, `image/webp` (50 MB), `video/mp4`, `video/quicktime` (250 MB), and for LinkedIn document posts `application/pdf`, `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `application/msword` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (100 MB). A PDF is read from its `%PDF-` signature. A DOC and a PPT share one container format, and so do a DOCX and a PPTX, so for those the bytes are checked and the `.doc`, `.ppt`, `.docx` or `.pptx` extension picks the type; a file without one is refused.

**Bulk schedule from a CSV.** `post bulk --csv september.csv` validates every row before sending anything, uploads local media once per content hash however many rows reference it, chunks into batches of 100, and reports failures with their row number. Columns are `text`, `scheduledAt`, `contentType` (`TEXT`, `IMAGE`, `VIDEO` or `CAROUSEL`, inferred from `media` when empty), `media` (`;`-separated), `alt` (`;`-separated alt text, one per `media` entry in the same order), `thumbnail`, `thumbnailMs`, and these per-platform columns, where `<PLATFORM>` is a name such as `TWITTER` or `GOOGLE_BUSINESS`:

| Column | Sends, for that row |
|---|---|
| `text_<PLATFORM>` | `platformTexts` |
| `config_<PLATFORM>` | The platform's config, as a JSON object. Rows with different configs go out as separate requests |
| `firstComment_<PLATFORM>` | `firstComments`, the whole cell as one comment |
| `thread<N>_<PLATFORM>` | Reply N of the platform's thread in `threadReplies`, the whole cell as its text, N from 1 to 25. Number a row's replies from 1 without gaps; rows can have threads of different lengths |
| `threadMedia<N>_<PLATFORM>` | The images of reply N (`;`-separated, up to 4). A reply with images can leave its `thread<N>_<PLATFORM>` cell empty |
| `thumbnail_<PLATFORM>` | `platformThumbnails[].thumbnailUrl` |
| `thumbnailMs_<PLATFORM>` | `platformThumbnails[].thumbnailTimestampMs` |
| `media_<PLATFORM>` | `platformMedia[].mediaUrls`, the platform's own media in place of `media` (`;`-separated) |
| `alt_<PLATFORM>` | `platformMedia[].mediaAltTexts`, one alt text per line of the cell, in the same order as `media_<PLATFORM>`. An empty line skips a file. Needs `media_<PLATFORM>` |
| `aspectRatio_<PLATFORM>` | `platformAspectRatios[].aspectRatio`: `SQUARE`, `PORTRAIT`, `VERTICAL` or `LANDSCAPE` |
| `fit_<PLATFORM>` | `platformAspectRatios[].fit`: `CROP` or `PAD`. Needs `aspectRatio_<PLATFORM>` |

`--dir` files take the same options in their platform blocks. Keeping X links clickable is not available for bulk scheduling, so a `--dir` file with `keepLinks` is refused. LinkedIn document posts cannot be bulk scheduled, so a `DOCUMENT` row or a `config_LINKEDIN` column is refused; create those with `post create`.

**Watch a post land.** Publishing is asynchronous and `queuedPlatforms` is not an outcome. `post watch` polls the results endpoint on a decaying schedule (5 s for a minute, 15 s for five, 60 s after) and prints each platform the moment its state changes.

## Commands

Grammar is noun then verb, space-separated. `ls` works wherever `list` does, `rm` wherever `delete` does, and `view` wherever `get` does.

### accounts

| Command | Key flags | Notes |
|---|---|---|
| `accounts list` | `--platform`, `--status` | Connected accounts and which need reconnecting |
| `accounts view <id>` | | One account by its id or Facebook page id |
| `accounts check <id>` | | Facebook pages only. Takes the account id or the Facebook page id |
| `accounts remove <id>` | `--yes` | Disconnects the account from the workspace, the same as removing it on the Connectors page. Works on accounts that need reconnecting too. Pending and recurring posts stop publishing to it. For Facebook only that page goes, other pages from the same login stay. Takes the account id or the Facebook page id. Asks first unless you pass `--yes`. Alias `rm` |
| `accounts instagram-audio <id>` | `--type music\|original_sound`, `--search` | Music and original sounds the Instagram account can add to a reel. `--type` defaults to `music`; without `--search` it lists what is trending. Pass the `AUDIO ID` to `post create --ig-audio`. Only accounts connected through Facebook can add audio, which `accounts view` shows as `reel audio` |
| `accounts pinterest-boards <id>` | | Every board the Pinterest account can pin to, secret boards included, with its privacy and pin count. Pass the `BOARD ID` to `post create --pinterest-board`, or the `NAME` to `--pinterest-board-name`. A board belongs to one Pinterest account, so list the boards of each account you post to. The API answers 400 when Pinterest refuses the request, usually because the account must be reconnected |
| `accounts wordpress-categories <id>` | | Every category of the WordPress site, sorted by name, with its id and its parent's id. Pass the `CATEGORY ID` to `post create --wordpress-category`. Alias `wp-categories`. The API answers with an error when the site refuses the request or cannot be reached, and a site that refuses needs reconnecting |
| `accounts linkedin-organization <query>` | | Looks up a LinkedIn company page by its URL (`https://www.linkedin.com/company/acme/`), its vanity name (`acme`) or `@acme`, and prints its id, URN and the `mention` to paste into a LinkedIn post. LinkedIn matches the exact vanity name only, so `acm` or a name with spaces finds nothing. A LinkedIn account of the workspace runs the lookup; when none can, the API answers 400 `linkedin_organization_lookup_unavailable`, and connecting or reconnecting one, ideally a company page you administer, fixes it. Needs the `accounts.read` permission. Alias `li-org` |

Google Business Profile locations show up as `GOOGLE_BUSINESS` accounts, named after the location and with no handle. Telegram channels and groups show up as `TELEGRAM` accounts, named after the chat, with its public @username as the handle when it has one. `accounts remove` disconnects a Telegram chat like any other account. Tumblr blogs show up as `TUMBLR` accounts, one per blog. Self-hosted WordPress sites show up as `WORDPRESS` accounts, one per site; connect one on the Connectors page or through a connect link.

### post

| Command | Key flags | Notes |
|---|---|---|
| `post create` | `-t/--text`, `-f/--file`, `-P/--platform`, `-a/--account`, `-m/--media`, `--alt`, `--type`, `-s/--at`, `--timezone`, `--draft`, `--repeat`, `--every`, `--on` (repeatable), `--until`, `--count`, `--watch`, `--dry-run`, `--print-body` | `-` on `--text` or `--file` reads stdin. `--alt` is the alt text for the `--media` image at the same position. `--type` is `TEXT`, `IMAGE`, `VIDEO`, `CAROUSEL` or `DOCUMENT`, inferred from `--media` when omitted. `--repeat` needs `--at`. `--draft` with `--at` saves a draft with that planned date, and `post publish` later schedules it for that date. `--dry-run` sends the post to `POST /social-posts/validate`, which runs every check a real create runs plus the ones that usually fail at publish time, and creates nothing. It prints one line per account with its problems and exits 5 when the post would be refused. Local media is uploaded first so the server can inspect it. `--print-body` prints the request body without contacting the server |
| `post list` | `--status`, `--platform`, `--from`, `--to`, `--sort`, `--limit`, `--offset`, `--all` | |
| `post get <id>` | | Post header plus one row per platform. A story shared next to an Instagram or Facebook post shows as its own `story` row, and a `FIRST COMMENT` column appears when any platform has one. A `THREAD` column appears when any platform has a thread: its status (`PENDING`, `PUBLISHED` or `FAILED`), how many replies went out, how many images the replies carry, and why it stopped, as in `FAILED · 1/3 replies sent: <error>`. `--json` returns `threadReplies`, `threadReplyMediaUrls`, `threadStatus`, `threadReplyIds`, `threadError` and `threadPublishedAt` per platform. A `MEDIA` column appears when any platform has its own media, and `--json` returns it as `mediaOverrideUrls` and `mediaOverrideAltTexts`, while each platform's `mediaUrls` is what it publishes |
| `post update <id>` | Same as `create` minus `--draft`, `--watch` and the repeat flags, plus `--clear-threads` and `--clear-platform-media` | `--platform` replaces every target on the post, so it confirms first. Per-platform media sent on update replaces every stored override, so resend the media of each platform you want to keep. Without `--media-for` or `media:` in a platform block the stored overrides stay, `--clear-platform-media` removes them all, and `media: []` in a platform block of `--file` leaves that platform out. Thread replies sent on update replace every stored thread, so resend the thread of each platform you want to keep; `--clear-threads` removes them all, and `thread: []` in a platform block of `--file` sends that platform's thread as empty. The API saves alt text only when the targets are sent too, so `--alt` (or `alt:` in `--file`) without `--platform` reads the post first and sends its current targets back unchanged. Moving a scheduled post more than a minute into the past fails with a 400 |
| `post delete <id>` | `--yes` | |
| `post results <id>` | | The only source of truth for what published |
| `post retry <id>` | `--platform-id` (repeatable), `-P, --platform` (repeatable), `--failed` | No flags retries every FAILED platform server-side. `--platform BLUESKY` retries every failed entry of that platform. `--failed` resolves the ids locally first |
| `post publish <id>` | `-s/--at`, `--now`, `--timezone` | Drafts only. `--at` schedules the draft for that time, and a past time publishes it now. Without `--at` or `--now`, a draft with a planned date in the future is scheduled for that date and any other draft publishes now. `--now` publishes now even when the draft has a planned date. `--at` and `--now` cannot be combined |
| `post unschedule <id>` | | Turns a scheduled or dated draft post back into an undated draft. 404 for another workspace's post |
| `post watch <id>` | `--timeout` | Exit 0 all published, 1 any failed, 8 timeout |
| `post bulk` | `--csv`, `--json-file`, `--dir`, `-P/--platform`, `-a/--account`, `--timezone`, `--dry-run`, `--print-body` | Chunks of 100. A `--dir` post without `type:` gets its content type from its `media:`, the same way `post create` does. `--dry-run` checks every row with `POST /social-posts/bulk/validate`, names the refused rows by line and exits 5 when any would be refused. `--print-body` prints the request bodies without contacting the server |

Per-platform flags on `post create` and `post update`:

| Flag | Sends |
|---|---|
| `--text-for <PLATFORM=text>` | `platformTexts` |
| `--config <PLATFORM=json>` | The platform's `*Configs` entry, one per account of that platform. Keys are checked against what the API reads, so a misspelt key exits 5 and names the closest real one instead of being dropped |
| `--tiktok-privacy <level>` | `tiktokConfigs[].privacyLevel` |
| `--ig-type <type>` | `instagramConfigs[].postType` |
| `--ig-trial <graduation>` | `instagramConfigs[].trialGraduation`: `MANUAL` (you share it to followers from the Instagram app) or `SS_PERFORMANCE` (Instagram shares it if it performs well). Video reels only; a story, image or carousel is rejected |
| `--yt-title <title>` | `youtubeConfigs[].videoTitle` |
| `--yt-ai-generated` | `youtubeConfigs[].aiGenerated`: disclose altered or synthetic content, such as an AI voice, an AI avatar or realistic footage that was generated or edited. YouTube shows its "Altered or synthetic content" label on the video. Works on videos and Shorts |
| `--yt-audio-language <tag>` | `youtubeConfigs[].defaultAudioLanguage`, the language spoken in the video's original audio, as a BCP-47 tag such as `en`, `pt-BR` or `es-419`, so YouTube does not treat a Portuguese video as English. Max 35 characters. It does not turn off YouTube's automatic dubbing. `none` sends null, which clears a saved language |
| `--yt-schedule-on-youtube` | `youtubeConfigs[].scheduleOnYouTube`. AdaptlyPost uploads the video as soon as the post is scheduled, as a private video with YouTube's own publish time set to `--at`, and YouTube publishes it at that time. Use it to set up Test & Compare for thumbnails and titles in YouTube Studio before the video goes public. The privacy must be `public` or unset, or the API answers 400 with `YOUTUBE_SCHEDULE_REQUIRES_PUBLIC`, and a repeating post is refused with `YOUTUBE_SCHEDULE_NOT_RECURRING`. With `--at` less than 15 minutes away the video uploads at `--at` as usual. `post get --json` shows `youtubeScheduleOnYouTube` and, once the upload is done, `youtubeScheduledVideoId`. From then until the video is published, `post update`, `post unschedule` and `post publish` fail with a 409 (exit 6). To change the post, delete it and schedule it again. `post delete` before `--at` also deletes the video from YouTube. If YouTube refuses, the delete fails with a 502 and the post stays, so try again, after reconnecting the channel if it was disconnected |
| `--pinterest-board <id>` | `pinterestConfigs[].boardId`, the board the pin goes to. Optional. Without it the pin goes to a public board named AdaptlyPost, which AdaptlyPost creates on the Pinterest account the first time it is needed. Find ids with `accounts pinterest-boards` |
| `--pinterest-board-name <name>` | `pinterestConfigs[].boardName`, the board picked by its name on each Pinterest account of the post. The API trims the name, takes the one board with exactly that name, and otherwise the one board with that name in any case. No match, or several, is a 400, and the pin never goes to another board. `--print-body` looks the name up and shows the board's name and id, and exits 5 when no board or several boards match. `--dry-run` reports the same refusal as a `PINTEREST_BOARD_NOT_FOUND` or `PINTEREST_BOARD_AMBIGUOUS` issue. Not with `--pinterest-board` |
| `--document-title <title>` | `linkedinConfigs[].documentTitle`, the title LinkedIn shows on a DOCUMENT post. Max 100 characters, defaults to the file name, ignored for other content types |
| `--li-reshare <urn\|url>` | `linkedinConfigs[].reshareOf`, reshare a LinkedIn post from the account with the text as the commentary. Takes a `urn:li:share:` or `urn:li:ugcPost:` URN, such as the `platformPostId` from `post results`, or a `https://www.linkedin.com/feed/update/<urn>` link. `urn:li:activity:` links are refused, because LinkedIn cannot reshare them through its API. Media on the post is not attached on LinkedIn |
| `--x-quote <url\|id>` | `twitterConfigs[].quoteOf`, quote one of the X account's own posts with the text as the commentary. Takes a post link such as `https://x.com/<handle>/status/<id>` or the numeric id. X only lets an account quote its own posts or posts that mention it, so a link naming another handle is refused. The text is required and media on the post is not attached on X |
| `--tumblr-tag <tag>` | `tumblrConfigs[].tags`, repeatable, up to 30 tags of up to 140 characters each. One tag per flag: a tag with a comma exits 5, because Tumblr would split it. A leading `#` is dropped and a repeated tag keeps its first spelling |
| `--tumblr-title <title>` | `tumblrConfigs[].title`, a heading shown above the media and the text. Max 4096 characters |
| `--tumblr-source-url <url>` | `tumblrConfigs[].sourceUrl`, the source link of the post. Max 2048 characters |
| `--wordpress-title <title>` | `wordpressConfigs[].title`. Max 300 characters. Without it the title is the first line of the text, cut to 100 characters |
| `--wordpress-excerpt <text>` | `wordpressConfigs[].excerpt`, the summary WordPress shows in post lists and feeds. Max 1000 characters |
| `--wordpress-category <id>` | `wordpressConfigs[].categoryIds`, repeatable, up to 50 category ids of the site. Without it WordPress files the post under the site's default category. Find ids with `accounts wordpress-categories` |
| `--wordpress-tag <tag>` | `wordpressConfigs[].tags`, repeatable, one tag name per flag, up to 50 tags of up to 100 characters each. A repeated tag keeps its first spelling. A tag the site does not have yet is created when the WordPress user may manage tags, and skipped otherwise |
| `--wordpress-status <status>` | `wordpressConfigs[].status`: `publish` (the default) publishes the post live on the site, `draft` leaves a WordPress draft you finish and publish or schedule in WordPress, `pending` submits it for review. For `draft` and `pending` the post link opens the post in the WordPress editor |
| `--first-comment <PLATFORM=text>` | `firstComments`, a comment posted from the same account about 10 seconds after the post goes out (60 on YouTube). One flag per platform: LINKEDIN (1250 characters), TWITTER (280), THREADS (500), BLUESKY (300), MASTODON (500), YOUTUBE (10000), FACEBOOK (8000), INSTAGRAM (2200). Facebook and Instagram stories take none, and a Page or Instagram account connected before Facebook and Instagram got first comments needs one reconnect, or its comment fails. A comment that fails never fails the post; `post get` shows its status. On `post update` the flags replace every stored first comment |
| `--thread-reply <PLATFORM=text>` | `threadReplies`, which turns the post into a thread: the post opens it, and each reply goes out from the same account under the one before, starting about 10 seconds after the post publishes. Repeat the flag once per reply, in order, as in `--thread-reply "X=Second post" --thread-reply "X=Third post"`. Everything after the first `=` is the text, commas and `=` included. `X=` with nothing after it is a reply that only carries images. TWITTER (280 characters per reply, more on X Premium), THREADS (500), BLUESKY (300), MASTODON (500, or the instance's limit), up to 25 replies per platform. A platform with `--first-comment` cannot have a thread too. A thread that fails never fails the post; `post get` shows its status. On `post update` the flags replace every stored thread |
| `--thread-media <PLATFORM:N=path\|url>` | `threadReplies[].mediaUrls`, an image for reply N of that platform's `--thread-reply` flags, counted from 1. Repeat it for each image, up to 4 per reply, as in `--thread-media "X:2=./chart.png"`. JPEG, PNG, GIF or WebP; local JPEG, PNG and WebP files are uploaded first, and a GIF has to be an https URL. No videos |
| `--thumbnail-for <PLATFORM=url>` | `platformThumbnails[].thumbnailUrl`, a thumbnail image for one platform of a VIDEO post. YOUTUBE, FACEBOOK, LINKEDIN, INSTAGRAM, PINTEREST, TELEGRAM |
| `--thumbnail-ms-for <PLATFORM=ms>` | `platformThumbnails[].thumbnailTimestampMs`, a video frame for one platform. YOUTUBE, FACEBOOK, LINKEDIN, INSTAGRAM, PINTEREST, TELEGRAM, TIKTOK. When a platform gets both an image and a frame, the image wins, except on TIKTOK, which takes only a frame. A platform without either flag uses `--thumbnail` and `--thumbnail-ms` |
| `--media-for <PLATFORM=path\|url>` | `platformMedia[].mediaUrls`, media for one platform in place of `--media`. One file per flag, repeated in order. It must fit the post type, and the post must go to that platform. Local files are uploaded first |
| `--alt-for <PLATFORM=text>` | `platformMedia[].mediaAltTexts`, the alt text for the `--media-for` file of that platform at the same position. One text per flag, up to 1000 characters; `PLATFORM=` skips a file |
| `--aspect-ratio <PLATFORM=ratio>` | `platformAspectRatios[].aspectRatio` for IMAGE and CAROUSEL posts: `SQUARE` (1:1), `PORTRAIT` (4:5), `VERTICAL` (9:16) or `LANDSCAPE` (1.91:1). INSTAGRAM takes all but VERTICAL, TIKTOK takes all four |
| `--fit <PLATFORM=fit>` | `platformAspectRatios[].fit`: `CROP` (the default, cut from the center) or `PAD` (keep the whole image on a blurred fill) |
| `--ig-share-to-story` | `instagramConfigs[].shareToStory`: also publish the media as a story next to the feed post or reel. The story is its own platform entry and skips the caption, first comment, cover, collaborators, trial and audio. Videos up to 60 seconds |
| `--ig-collaborator <username>` | `instagramConfigs[].collaborators`, repeatable, up to 3. A leading `@` is dropped. Feed images, carousels and reels; each collaborator accepts the invite in Instagram |
| `--ig-user-tag <username[:x,y]>` | `instagramConfigs[].userTags`, repeatable, up to 20, as in `--ig-user-tag ada.bakes:0.42,0.61`. A leading `@` is dropped and a repeated username keeps its first entry. `x` and `y` run from 0 to 1 from the top-left corner (x left to right, y top to bottom): needed on a feed image, optional on a story, ignored on a video, where the person is tagged on the video as a whole. Works on one image or one video; a carousel or several stories with tags is a 400. Tagged accounts must be public. The story `--ig-share-to-story` adds does not carry the tags. `post get` shows them as `instagramUserTags` |
| `--ig-ai-generated` | `instagramConfigs[].aiGenerated`: disclose that the post was made or edited with AI. Instagram shows its "AI info" label on the post. Works on images, carousels, reels and stories, and a story made with `shareToStory` carries the label too. |
| `--ig-audio <audioId>` | `instagramConfigs[].audio.audioId`, music or an original sound for a reel. Find ids with `accounts instagram-audio`. `--ig-audio-title` and `--ig-audio-artist` are stored for display; `--ig-audio-volume` and `--ig-video-volume` take 1 to 100 and default to 100 |
| `--fb-share-to-story` | `facebookConfigs[].shareToStory`, the same as `--ig-share-to-story` for a Facebook page |
| `--fb-ai-generated` | `facebookConfigs[].aiGenerated`: disclose that the video was made or edited with AI. Facebook shows its "AI info" label on the post. Works on every VIDEO post, whatever its `postType`, since Facebook publishes every video as a reel, and a video story carries the label too. Photos, carousels and text posts are a 400 |
| `--fb-text-background <presetId>` | `facebookConfigs[].textFormatPresetId`, a colored background such as `106018623298955` (solid purple) or `249307305544279` (red to blue). TEXT posts with no media and up to 130 characters only |
| `--fb-layout <layout>` | `facebookConfigs[].imageLayout`: `grid` (the default, a photo grid) or `carousel` (swipeable cards, each opening its own link). `grid` cannot go with `--fb-card` |
| `--fb-card <link\|title\|description>` | `facebookConfigs[].carouselCards`, repeatable, one card per image in the order of `--media`, up to 5. The fields are split on `\|`, so the title cannot hold one; title (max 100 characters) and description (max 200) are optional, as in `--fb-card "https://acme.example/shoes\|Shoes"`. A card implies `--fb-layout carousel`. A carousel needs 2 to 5 images, no videos and a FEED post, or the API answers 400. Facebook shows the card's image and title only for links to a website the Page owns; any other link fails the post with a message saying so |
| `--x-keep-links`, `--no-x-keep-links` | `twitterKeepLinks`. By default links in X text are broken (`example. com`), because X charges over 10 times more for a post with a link. Only AppSumo lifetime deals can keep them, and a kept link costs 20 credits instead of 2; any other plan gets a 400 |
| `--gbp-topic <type>` | `googleBusinessConfigs[].topicType`: `STANDARD` (an update, the default), `EVENT` or `OFFER`. EVENT and OFFER need `--gbp-event-title`, `--gbp-event-start` and `--gbp-event-end` |
| `--gbp-cta <type>`, `--gbp-cta-url <url>` | `callToActionType` and `callToActionUrl`: `BOOK`, `ORDER`, `SHOP`, `LEARN_MORE`, `SIGN_UP` or `CALL`. Every button except CALL needs the URL; CALL dials the phone number on the profile |
| `--gbp-event-title`, `--gbp-event-start`, `--gbp-event-end` | `eventTitle`, `eventStart`, `eventEnd`. Dates are `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` in the business's local time, with no offset |
| `--gbp-coupon`, `--gbp-redeem-url`, `--gbp-terms` | `offerCouponCode`, `offerRedeemUrl`, `offerTerms` for an OFFER |

Google Business Profile takes TEXT or IMAGE posts with one JPEG or PNG up to 5 MB and text up to 1500 characters, and has no alt text. A location with no `--gbp-*` flag posts a STANDARD update.

Telegram takes TEXT, IMAGE, VIDEO or CAROUSEL posts: text up to 4096 characters, up to 10 JPEG, PNG or WebP images of 10 MB each, or one MP4 or MOV video up to 50 MB. A caption over 1024 characters goes out as its own message after the media. A video takes a thumbnail image (`--thumbnail-for TELEGRAM=<url>`) or a video frame (`--thumbnail-ms-for TELEGRAM=<ms>`). Telegram has no first comments, aspect ratios, config keys or analytics. `-P tg` is short for `-P TELEGRAM`.

Tumblr takes TEXT, IMAGE, VIDEO or CAROUSEL posts: text up to 32768 characters, up to 30 JPEG, PNG or GIF images of 10 MB each, or one MP4 video up to 500 MB and 10 minutes. Images keep their `--alt` text. The `--tumblr-*` flags set the tags, a title and a source link for every Tumblr blog of the post; in a file they go in a `tumblr:` block as `tags` (a YAML list, with a tag that starts with `#` in quotes), `title` and `sourceUrl`. Tumblr has no first comments, per-platform thumbnails, aspect ratios or analytics. `-P tb` is short for `-P TUMBLR`.

WordPress publishes the text as the body of a blog post on a self-hosted site: blank lines start new paragraphs and bare links become clickable. Text goes up to 100,000 characters, with up to 20 media items: images up to 20 MB and video up to 500 MB. The first image is the featured image, and the other images or the video follow the text. Images keep their `--alt` text. The `--wordpress-*` flags set the title, excerpt, categories, tags and status for every WordPress site of the post; in a file they go in a `wordpress:` block as `title`, `excerpt`, `categoryIds` (a YAML list of ids), `tags` (a YAML list) and `status` (`PUBLISH`, `DRAFT` or `PENDING`). `--wordpress-status draft` is not `--draft`: the post still has to be scheduled or published to reach the site, where it then waits as a draft. WordPress has no first comments, per-platform thumbnails, aspect ratios or analytics. `-P wp` is short for `-P WORDPRESS`.

```bash
adaptlypost post create -t "Autumn sale, 20% off" -a gbp_51e0 -m ./sale.png \
  --gbp-topic OFFER --gbp-event-title "Autumn sale" --gbp-event-start 2026-10-20 --gbp-event-end 2026-10-27 \
  --gbp-coupon AUTUMN20 --gbp-cta SHOP --gbp-cta-url https://acme.example/shop

adaptlypost post create -t "New reel" -a ig_7c3e -m ./reel.mp4 --ig-type REEL \
  --ig-share-to-story --ig-collaborator acme.bakery --ig-audio 1234567890 --ig-audio-volume 40

adaptlypost post create -t "Slides from today's talk" -a li_22aa -a tw_4d1b \
  --first-comment "LINKEDIN=Download the deck: https://acme.example/deck" \
  --first-comment "TWITTER=Deck link in the next post"
```

Like the other config flags, the Instagram, Facebook, Google Business Profile, Tumblr and WordPress flags, `--x-quote` and `--li-reshare` reach the API on `post update` only together with `--platform` or `--account`. `post bulk` refuses LinkedIn document posts, LinkedIn reshares and X quotes, because the bulk endpoint takes neither `linkedinConfigs` nor `twitterConfigs`. `--first-comment`, the thumbnail, media and aspect ratio flags and `--x-keep-links` work on their own.

Repeat flags, `post create` only:

| Flag | Sends |
|---|---|
| `--repeat <frequency>` | `recurrence.frequency`: `DAILY`, `WEEKLY`, `MONTHLY` or `YEARLY`. Needs `--at` |
| `--every <n>` | `recurrence.interval`, 1 to 30. Defaults to 1 |
| `--on <weekday>` | `recurrence.weekdays`, repeatable, WEEKLY only. `MONDAY` to `SUNDAY` or the first three letters |
| `--until <YYYY-MM-DD>` | `recurrence.endsOn`, the last day a post may go out. Not with `--count` |
| `--count <n>` | `recurrence.maxOccurrences`, 2 to 365 posts in total. Not with `--until` |

### recurring

| Command | Key flags | Notes |
|---|---|---|
| `recurring list` | `--status` (repeatable: `ACTIVE`, `PAUSED`, `ENDED`), `--limit`, `--offset`, `--all` | Status, schedule, next slot and post count per series |
| `recurring get <id>` | | Schedule, pause reason, last error and targets |
| `recurring pause <id>` | | Stops creating posts and deletes the upcoming scheduled post |
| `recurring resume <id>` | | Continues from the next slot after now. Slots missed while paused are skipped |
| `recurring delete <id>` | `--yes` | Stops the series and deletes its upcoming scheduled post. Published posts stay |

A series pauses itself after 3 failed posts in a row, when the subscription lapses, when its creator loses workspace access, when one of its accounts is disconnected, or when a platform rejects the content. `recurring get` shows which as `paused by`. Editing a series and skipping one date are only in the app. Post objects from `post list` and `post get` carry `recurringPostId` and `occurrenceAt` when they belong to a series.

### media

| Command | Key flags | Notes |
|---|---|---|
| `media upload <files...>` | `--concurrency` | Mints the URLs and PUTs the bytes |
| `media urls <files...>` | | Mints the URLs only, for your own uploader |

Per-platform config keys, for `--config`, frontmatter platform blocks and `config_<PLATFORM>` columns. The account id is filled in for you:

| Platform | Keys |
|---|---|
| `FACEBOOK` | `postType`, `shareToStory`, `videoTitle`, `textFormatPresetId`, `imageLayout` (`GRID` or `CAROUSEL`), `carouselCards` (a list of blocks with `link`, `title` and `description`, or bare links; cards without `imageLayout` mean `CAROUSEL`), `aiGenerated` |
| `INSTAGRAM` | `postType`, `shareToStory`, `trialGraduation`, `collaborators`, `userTags` (a list of blocks with `username`, `x` and `y`, or bare usernames), `aiGenerated`, `audio` (an audio id, or a block with `audioId`, `title`, `artist`, `audioVolume`, `videoVolume`) |
| `TIKTOK` | `privacyLevel`, `title`, `caption`, `allowComments`, `allowDuet`, `allowStitch`, `sendAsDraft`, `aiGenerated`, `brandedContent`, `brandedContentOwnBrand`, `autoAddMusic` |
| `PINTEREST` | `boardId`, `boardName`, `title`, `link`. Set `boardId` or `boardName`, not both. `boardName` picks the board by its name, the same way `--pinterest-board-name` does. With neither, the pin goes to a board named AdaptlyPost |
| `YOUTUBE` | `postType`, `videoTitle`, `tags`, `privacyStatus`, `license`, `notifySubscribers`, `allowEmbedding`, `madeForKids`, `aiGenerated`, `categoryId`, `playlistId`, `defaultAudioLanguage`, `scheduleOnYouTube` |
| `LINKEDIN` | `documentTitle`, `reshareOf` |
| `TWITTER` | `quoteOf` |
| `TUMBLR` | `tags` (a list, one tag per item, no commas), `title`, `sourceUrl` |
| `WORDPRESS` | `title`, `excerpt`, `categoryIds` (a list of category ids), `tags` (a list, one tag per item), `status` (`PUBLISH`, `DRAFT` or `PENDING`) |
| `GOOGLE_BUSINESS` | `topicType`, `callToActionType`, `callToActionUrl`, `eventTitle`, `eventStart`, `eventEnd`, `offerCouponCode`, `offerRedeemUrl`, `offerTerms`. `topicType` defaults to `STANDARD` |

### connect

| Command | Key flags | Notes |
|---|---|---|
| `connect create` | `--name`, `--private`, `--platform`, `--max-accounts`, `--expires`, `--never-expires`, `--timezone` | A link a client opens to connect their own accounts to this workspace. Prints the url, the token and when it expires. With no flags it is a quick link: every platform, every account in the workspace visible, no limit, 7 days. `--private` shows the client only the accounts they connect through the link. `--platform` is repeatable and limits the platforms offered. `--max-accounts` stops the link once that many accounts are connected through it. `--expires` takes the same times as `post create --at` (`2026-11-30 18:00`, `+30d`, an ISO date-time) and must be 1 hour to 365 days away. `--never-expires` keeps the link working until you revoke it |
| `connect revoke <token>` | `--yes` | Confirms first. The link stops working at once |

### webhook

| Command | Key flags | Notes |
|---|---|---|
| `webhook create` | `--url`, `--event` (repeatable) | The only place the signing secret is ever returned, so store it then. Without `--event` the webhook gets the default set: `post.published`, `post.partially_failed`, `post.failed`, `post.scheduled`, `account.unauthorized`, `image.completed` and `image.failed`. Inbox events (`comment.created`, `comment.replied`, `mention.created`, `message.received`, `review.created`) arrive only when you name them, and a webhook with `--event` gets only the events it names |
| `webhook list` | | Status is `active`, `inactive` or `disabled`. The API disables a webhook whose deliveries keep failing |
| `webhook get <id>` | | |
| `webhook update <id>` | `--url`, `--active`, `--inactive`, `--event` (repeatable), `--default-events` | `--event` replaces the stored events. `--default-events` goes back to the default set |
| `webhook delete <id>` | `--yes` | Confirms first |
| `webhook test <id>` | | Sends a test delivery. Exits 1 when the endpoint does not answer 2xx |

### inbox

Comments on the account's posts, mentions, direct messages and Google Business Profile reviews. Comments come from Facebook, Instagram, Threads, YouTube, Bluesky, Mastodon and LinkedIn; mentions from Facebook, Instagram, Threads, Bluesky and Mastodon; messages from Facebook, Instagram, Bluesky and Mastodon; reviews from Google Business Profile. TikTok and X have no inbox. Reading needs the `inbox.read` permission and every change needs `inbox.reply` and an active plan.

| Command | Key flags | Notes |
|---|---|---|
| `inbox summary` | | Unread counts per channel, and per account whether each channel works (`yes`), needs a reconnect (`reconnect`) or does not exist on that platform (`—`) |
| `inbox refresh` | | Queues a sync now. The inbox also syncs every 10 minutes per account |
| `inbox comments list` | list flags below, `--post`, `--platform-post` | `--post` takes an AdaptlyPost post id from `post list`, `--platform-post` the platform's own post id |
| `inbox comments get <id>` | | The comment, the comment it answers and its replies. `can` lists what the platform allows on it: reply, hide, delete, like |
| `inbox comments reply <id>` | `-t/--text` | The platform's comment limit applies: LinkedIn 1250, Threads 500, Bluesky 300, Mastodon 500, YouTube 10000, Facebook 8000, Instagram 2200 |
| `inbox comments hide <id>`, `unhide <id>` | | |
| `inbox comments like <id>`, `unlike <id>` | | Facebook, Bluesky, Mastodon and LinkedIn |
| `inbox comments delete <id>` | `--yes` | Facebook, Instagram and LinkedIn delete any comment on the account's posts; YouTube, Threads, Bluesky and Mastodon only the account's own replies. Asks first unless you pass `--yes` |
| `inbox comments status <ids...>` | `--to` | `UNREAD`, `READ` or `DONE` for up to 100 ids. `-` reads one id per line from stdin |
| `inbox mentions list` | list flags below | |
| `inbox mentions reply <id>` | `-t/--text` | |
| `inbox mentions status <ids...>` | `--to` | |
| `inbox conversations list` | list flags below | Latest message first. Alias `dm` |
| `inbox conversations get <id>` | | The messages, oldest first. `reply until` is the end of the 24-hour window on Facebook and Instagram |
| `inbox conversations send <id>` | `-t/--text` | Up to the conversation's `max length` |
| `inbox conversations status <ids...>` | `--to` | |
| `inbox reviews list` | list flags below, `--rating` (repeatable, 1 to 5), `--replied`, `--unreplied` | |
| `inbox reviews reply <id>` | `-t/--text` | Google allows one reply per review, so this replaces any reply already there. Up to 4096 bytes |
| `inbox reviews delete-reply <id>` | `--yes` | |
| `inbox reviews status <ids...>` | `--to` | |

List flags, on every `list`:

| Flag | Sends |
|---|---|
| `-a, --account <id>` | `accountIds`, repeatable, up to 50. The id from `accounts list` |
| `-P, --platform <platform>` | `platforms`, repeatable |
| `--status <status>` | `statuses`, repeatable: `UNREAD`, `READ`, `DONE` |
| `--since <date>` | `since`, only items created on the platform at or after it. An ISO 8601 date-time or an offset such as `-7d` |
| `--search <text>` | `search` |
| `--limit <n>` | `limit`, 1 to 100, 25 by default |
| `--cursor <cursor>` | `cursor`, the `nextCursor` of the previous page. The table prints it as `next: --cursor ...` and `--json` returns it in `meta.nextCursor` |
| `--all` | Follows `nextCursor` 100 items at a time until the last page, up to 50 requests |

`-t -` reads the text from stdin. Each inbox refusal comes with a hint. `inbox_reconnect_required` (exit 10) means the account lacks the permission for that channel or its login expired. Channels still waiting on the platform's review answer the same way. Reconnect the account on the Connectors page. `inbox_reply_invalid` means the text is empty or too long. `inbox_messaging_window_closed` means the 24-hour window on Facebook or Instagram has passed. `inbox_action_unsupported` means the platform does not allow that action on this item. `inbox_rate_limited` (exit 7) and `inbox_platform_error` (exit 1) can be retried later.

```bash
adaptlypost inbox comments list --status UNREAD --since -1d
adaptlypost inbox comments reply cm_8f2a -t "Thanks, it is back in stock on Friday"
adaptlypost inbox reviews list --rating 1 --rating 2 --unreplied --json | jq -r '.data[].id' \
  | adaptlypost inbox reviews status - --to READ
adaptlypost webhook create --url https://example.com/hooks/inbox --event comment.created --event review.created
```

### analytics

| Command | Key flags | Notes |
|---|---|---|
| `analytics overview` | `--from`, `--to`, `--platform`, `--account` | Defaults to the last 30 days and prints the resolved window |
| `analytics timeseries` | `--from`, `--to`, `--granularity`, `--platform`, `--account` | Table plus a views sparkline |
| `analytics breakdown` | `--from`, `--to`, `--account` | `--platform` is a usage error here; the API ignores it |
| `analytics posts` | `--sort-by`, `--page`, `--limit`, `--all`, `--platform`, `--account` | |
| `analytics top` | `--from`, `--to`, `--platform`, `--account`, `--sort-by`, `--limit` | The best posts in the window by one metric. Sorts by `VIEWS` and returns 10 unless told otherwise, 50 at most |
| `analytics discovered` | `--from`, `--to`, `--platform`, `--account`, `--limit` | Posts found on the connected accounts that were not published through AdaptlyPost. 200 by default, 1000 at most |
| `analytics sync-status` | | Per-account sync and discovery state |
| `analytics sync` | `--wait` | One run per workspace per ten minutes |

`--account` is repeatable and takes the account id from `accounts list`; it sends `connectionIds`, so the numbers cover only those accounts.

Analytics cover Facebook, Instagram, Threads, TikTok, Pinterest, Bluesky, LinkedIn, YouTube, X and Google Business Profile. Google Business Profile reports how often a location was seen, with no per-post numbers. Mastodon, Telegram, Tumblr and WordPress have no analytics, and `--platform` ignores them. Connecting an account imports its posts from the last 180 days, and a post keeps refreshing for 180 days after it is published.

### ai

| Command | Key flags | Notes |
|---|---|---|
| `ai caption` | `--prompt`, `--platform`, `--refine`, `--partial` | Caption text goes to stdout alone, even when piped, so it feeds `post create -t -`. Pass `--json` for the JSON document. `--refine <text>` rewrites that caption following `--prompt`, and `--partial` continues a partly written one. `-` on `--prompt` or `--refine` reads stdin |
| `ai image` | `--prompt`, `--aspect`, `--model`, `--quality`, `--reference` (repeatable, up to 5), `--session`, `--wait`, `--timeout`, `-o/--output` | Prints the job id and returns. `--wait` polls until the image is ready; `-o` also downloads it to a file or directory and implies `--wait`. Local `--reference` images are uploaded first |
| `ai image get <jobId>` | `--wait`, `--timeout`, `-o/--output` | Reads a job, and with `--wait` or `-o` waits for it |

Insufficient credits come back as exit 9, not a generic failure. A failed image exits 1 with the reason, and its credits are refunded. `--wait` gives up with exit 8 after `--timeout`, which defaults to 3 minutes.

### Everywhere else

| Command | Key flags | Notes |
|---|---|---|
| `login` | `--token-stdin`, `--profile`, `--api-url`, `--name` | |
| `logout` | `--profile`, `--all` | |
| `whoami` | | Workspace, role, what the key can do, and which source the token and the API URL came from |
| `config list \| get \| set \| unset \| path` | | Reads and writes `config.json` |
| `open [what] [id]` | | `dashboard`, `post <id>`, `accounts`, `analytics`, `inbox`, `tokens`, `webhooks` |
| `doctor` | `--json` | Node version, files, permissions, token, role, API reachability, rate limit |
| `completion <shell>` | | `bash`, `zsh`, `fish`, `powershell` |
| `mcp` | `--client`, `--local`, `--install` | Prints or installs the MCP client config |
| `api <method> <path>` | `-q/--query`, `-d/--data`, `-H/--header`, `-i/--include` | Raw authenticated request |

`api` is the escape hatch. A command we have not written yet never blocks you:

```bash
adaptlypost api GET /social-posts -q limit=5 -q statuses=DRAFT
adaptlypost api POST /webhooks -d '{"url":"https://example.com/hook"}'
adaptlypost api POST /webhooks -d @body.json
```

Repeat `-q` with the same key for an array parameter. `-d @-` reads the body from stdin. An `Authorization` header is rejected, because the token comes from the resolved profile and the CLI never sends it anywhere but the configured API host.

## Global flags

Accepted at any position.

| Flag | Default | Meaning |
|---|---|---|
| `-p, --profile <name>` | `current` | Credential profile |
| `--json` | auto | Force machine mode |
| `-q, --quiet` | false | No spinners, hints or notices |
| `--no-color` | auto | Strip ANSI |
| `--debug` | false | Request log to stderr, token redacted |
| `--api-url <url>` | production | Override the base URL, for staging |
| `--token <token>` | resolved | One-shot token, highest precedence |
| `-y, --yes` | false | Skip confirmation prompts |
| `--no-input` | auto | Never prompt; fail with exit 2 instead |
| `--lang <code>` | unset | `en`, `fr`, `de`, `es`, `pt` |
| `-V, --version` | | Prints `adaptlypost/1.3.2 node-v22.14.0 darwin-arm64` |
| `-h, --help` | | |

`--no-input` is implied when stdin is not a TTY.

## JSON output

Output mode is chosen for you. Human tables when stdout is a TTY, one JSON document when it is not, when `--json` is passed, when `CI` is set, or when `ADAPTLYPOST_JSON=1`. So `adaptlypost post list | jq '.data[0].id'` works with no flag.

```json
{
  "ok": true,
  "command": "post.list",
  "data": [{ "id": "post_9c3e1f", "...": "..." }],
  "meta": {
    "total": 47,
    "limit": 20,
    "offset": 0,
    "hasMore": true,
    "rateLimit": { "limit": 600, "remaining": 598, "resetSeconds": 41 }
  }
}
```

Four rules that will not change without a major version:

1. `data` is the API's payload unmodified. No renamed keys, no computed fields.
2. `data` is an array for list commands, an object for single-object commands, `null` for commands with no payload.
3. `meta` carries paging and rate-limit information and nothing else.
4. Errors go to stderr as `{ "ok": false, "command": "...", "error": { "code", "status", "message", "details" } }` and the process exits non-zero. stdout stays clean.

In human mode every spinner, prompt, hint, warning and notice goes to stderr, so a pipe never swallows them and never receives them. `ADAPTLYPOST_FORCE_TTY=1` keeps human output when piped, which is how the tables in this file were captured.

Add `--json` to a list command and the available field names are printed to stderr, so `adaptlypost post list --json 2>&1 >/dev/null` documents the shape.

`ai caption` is the one exception to the pipe rule. It writes the bare caption when piped, so it can feed another command, and prints the JSON document only under `--json` or `ADAPTLYPOST_JSON=1`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure, including 5xx |
| 2 | Usage error: bad flag, missing argument, unknown enum, prompt needed under `--no-input` |
| 3 | Auth failure: 401, missing or malformed token, a key whose creator lost access (`token_issuer_lost_access`), or an OAuth login with no AdaptlyPost account (`oauth_account_not_found`) |
| 4 | Not found: 404 |
| 5 | Validation or other 400 |
| 6 | Conflict: 409 |
| 7 | Rate limited: 429 after retries |
| 8 | Network failure or timeout |
| 9 | Quota or plan limit: 402, insufficient credits, 403 `subscription_required` |
| 10 | Permission denied: 403, the key is valid but its role cannot do this (`permission_denied`), or `workspaceId` names a workspace the key cannot act in (`workspace_access_denied`) |
| 130 | Interrupted with Ctrl-C |

Exit 3 means get a working key. Exit 10 means the key works and a workspace admin has to issue one under a higher role; nothing you retry from this machine changes it. In machine mode the `error.code` field carries the API's code (`permission_denied`, `subscription_required`, `token_issuer_lost_access`, `workspace_access_denied`, `oauth_account_not_found`) verbatim.

## Configuration and profiles

Two files, on macOS and Linux under `${XDG_CONFIG_HOME:-$HOME/.config}/adaptlypost/` and on Windows under `%APPDATA%\AdaptlyPost\`:

- `credentials.json`, mode 0600, tokens only. Written to a temp file and renamed over the target, so a crash never leaves a half-written or world-readable file. The CLI refuses to read it when the mode is group or world readable and prints the `chmod 600` line.
- `config.json`, mode 0644, preferences only. Safe to commit to a dotfiles repo.

A profile is a token plus the API URL it belongs to. Use them for several workspaces or for staging:

```bash
adaptlypost login --profile acme --name "Acme workspace"
adaptlypost post list --profile acme
export ADAPTLYPOST_PROFILE=acme
```

Profile resolution: `--profile`, then `ADAPTLYPOST_PROFILE`, then `current` in `credentials.json`, then `default`.

Token resolution, highest first: `--token`, `ADAPTLYPOST_API_TOKEN`, `ADAPTLYPOST_API_KEY`, the resolved profile.

Base URL resolution, highest first: `--api-url`, `ADAPTLYPOST_API_URL`, the profile's stored `apiUrl`, the compiled-in default. A base URL is only ever read from your own flags, environment or config file. The CLI never takes a host from an API response.

`config` keys:

| Key | Meaning |
|---|---|
| `timezone` | Default for `--timezone` |
| `defaultPlatforms` | Default for `--platform` |
| `language` | Default `x-language` header |
| `workspaceId` | Sent as the `X-Workspace-Id` header on every request. An API key belongs to one workspace, so this guards against using a key from the wrong one. The API then answers 403 `workspace_access_denied` and the CLI exits 10 |
| `updateCheck` | Set false to turn off the daily version check |

```bash
adaptlypost config set timezone Europe/Berlin
adaptlypost config set defaultPlatforms TWITTER,LINKEDIN
adaptlypost config list
adaptlypost config path
```

Run `adaptlypost doctor` when something is off. It checks the Node version, both files and their permissions, the token, API reachability and latency, the key's role, the OpenAPI document, the rate-limit budget and any proxy variables, and prints the fix for each failure. A rejected token fails the `api` check; a valid token whose role cannot publish passes it and warns on the `role` check instead, so the two never look alike. It exits 1 when any check fails and supports `--json`.

## Environment variables

| Variable | Meaning |
|---|---|
| `ADAPTLYPOST_API_TOKEN` | API token. Read first |
| `ADAPTLYPOST_API_KEY` | Same thing, accepted for compatibility with the MCP server and skills |
| `ADAPTLYPOST_API_URL` | Base URL. Defaults to `https://post.adaptlypost.com/post/api/v1` |
| `ADAPTLYPOST_PROFILE` | Profile name |
| `ADAPTLYPOST_WORKSPACE_ID` | Overrides the `workspaceId` config key |
| `ADAPTLYPOST_DEBUG` | Set to `1` for the request log on stderr |
| `ADAPTLYPOST_JSON` | Set to `1` to force machine output |
| `ADAPTLYPOST_FORCE_TTY` | Set to `1` to keep human output when piped |
| `ADAPTLYPOST_INSTALL_DIR` | Destination for the curl installer. Defaults to `~/.local/bin` |
| `NO_COLOR`, `FORCE_COLOR` | Honoured as usual |
| `CI` | When set, machine output and no update check |

Both token spellings work and `doctor` names the one in use. There is no third spelling; if you find one in older docs, it is wrong.

## Shell completion

The script is generated from the live command tree at runtime, so it cannot go stale. Installation instructions print to stderr, which is why `eval` on the stdout works directly.

```bash
# zsh
eval "$(adaptlypost completion zsh)"

# bash
eval "$(adaptlypost completion bash)"

# fish
adaptlypost completion fish | source

# powershell
adaptlypost completion powershell | Out-String | Invoke-Expression
```

Add the line to your shell rc file to keep it. The Homebrew formula installs completions for you.

## Links

- Dashboard: <https://adaptlypost.com>
- API tokens: <https://adaptlypost.com/api-tokens>
- MCP server, for Claude, Cursor, VS Code and Windsurf: <https://mcp.adaptlypost.com/mcp>. Run `adaptlypost mcp` to print the client config, or `adaptlypost mcp --install` to write it.
- RedReplier CLI, for Reddit and Hacker News mention monitoring: <https://github.com/RedReplier/redreplier-cli>
- Flowsery CLI, for web analytics, session replay and issue triage: <https://github.com/Flowsery/flowsery-cli>
- Issues: <https://github.com/adaptlypost/adaptlypost-cli/issues>

`Formula/adaptlypost.rb` in this repo is a reference copy of the Homebrew formula. Homebrew installs from the tap repo, `adaptlypost/homebrew-tap`, and the release workflow rewrites the copy there with the real checksums. Editing the file in this repo changes nothing that users install.

Releases are tagged with a leading `v`, as in `v1.2.3`. The binary asset URLs, the install script and the formula all embed that tag.

## License

MIT. See [LICENSE](./LICENSE).
