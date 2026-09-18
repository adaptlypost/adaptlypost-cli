# AdaptlyPost CLI

Schedule, publish and measure social posts from your terminal.

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

There is no OAuth or device-code flow yet. There is also no `/me` endpoint on the API, so `whoami` reconstructs your identity from the cheapest authenticated listing and says where each field came from.

`logout` removes the profile from the credentials file. It does not revoke the token; do that in the dashboard.

## Quick start

```
$ adaptlypost login
  Opening https://adaptlypost.com/api-tokens in your browser.
  Create a token, then paste it here.

  Token (starts with adaptly_): ****************************

  ✓ Token valid
    profile    default
    workspace  Default Workspace
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

**Post from a file or a pipe.** `post create --file launch.md` reads YAML frontmatter for platforms, accounts, schedule, timezone and per-platform overrides, and the markdown body as the post text. Local paths under `media:` are uploaded before the post is created and replaced with their public URLs. Flags override frontmatter.

```markdown
---
platforms: [TWITTER, LINKEDIN]
accounts: [tw_4d1b, li_22aa]
at: 2026-09-20T09:00:00Z
timezone: Europe/Berlin
media: [./hero.png]
linkedin:
  text: |
    A longer version for LinkedIn, because the audience is different.
---
Shipping the CLI today. Schedule, publish and check results without
leaving your terminal.
```

`-f -` reads the same document from stdin and `-t -` reads plain text, so `adaptlypost ai caption --prompt "announce the launch" | adaptlypost post create -t - -P TWITTER -a tw_4d1b` is one line.

**Upload that actually uploads.** `media upload` mints presigned URLs in chunks of 20 and PUTs the bytes with the exact MIME type the presign was signed for, sniffed from the first 12 bytes rather than the extension. A mismatched content type fails the S3 signature with an opaque error, which is the step everyone gets wrong by hand.

**Bulk schedule from a CSV.** `post bulk --csv september.csv` validates every row before sending anything, uploads local media once per content hash however many rows reference it, chunks into batches of 100, and reports failures with their row number.

**Watch a post land.** Publishing is asynchronous and `queuedPlatforms` is not an outcome. `post watch` polls the results endpoint on a decaying schedule (5 s for a minute, 15 s for five, 60 s after) and prints each platform the moment its state changes.

## Commands

Grammar is noun then verb, space-separated. `ls` works wherever `list` does, `rm` wherever `delete` does, and `view` wherever `get` does.

### accounts

| Command | Key flags | Notes |
|---|---|---|
| `accounts list` | `--platform`, `--status` | Connected accounts and which need reconnecting |
| `accounts check <id>` | | Facebook pages only. Takes the account id or the Facebook page id |

### post

| Command | Key flags | Notes |
|---|---|---|
| `post create` | `-t/--text`, `-f/--file`, `-P/--platform`, `-a/--account`, `-m/--media`, `-s/--at`, `--timezone`, `--draft`, `--watch`, `--dry-run` | `-` on `--text` or `--file` reads stdin |
| `post list` | `--status`, `--platform`, `--from`, `--to`, `--sort`, `--limit`, `--offset`, `--all` | |
| `post get <id>` | | Post header plus one row per platform |
| `post update <id>` | Same as `create` minus `--draft` and `--watch` | `--platform` replaces every target on the post, so it confirms first |
| `post delete <id>` | `--yes` | |
| `post results <id>` | | The only source of truth for what published |
| `post retry <id>` | `--platform-id` (repeatable), `--failed` | `--failed` reads the results first and retries every failed row |
| `post publish <id>` | `--at`, `--timezone` | Drafts only |
| `post watch <id>` | `--timeout` | Exit 0 all published, 1 any failed, 8 timeout |
| `post bulk` | `--csv`, `--json`, `--dir`, `-P/--platform`, `-a/--account`, `--timezone`, `--dry-run` | Chunks of 100 |

### media

| Command | Key flags | Notes |
|---|---|---|
| `media upload <files...>` | `--concurrency` | Mints the URLs and PUTs the bytes |
| `media urls <files...>` | | Mints the URLs only, for your own uploader |

### connect

| Command | Key flags | Notes |
|---|---|---|
| `connect create` | | A link a client can use to connect their own accounts |
| `connect revoke <token>` | | |

### webhook

| Command | Key flags | Notes |
|---|---|---|
| `webhook create` | `--url` | The only place the signing secret is ever returned |
| `webhook list` | | |
| `webhook get <id>` | | |
| `webhook update <id>` | `--url`, `--active`, `--inactive` | Events are not editable |
| `webhook delete <id>` | `--yes` | |
| `webhook test <id>` | | Sends a test delivery |

### analytics

| Command | Key flags | Notes |
|---|---|---|
| `analytics overview` | `--from`, `--to`, `--platform` | Defaults to the last 30 days and prints the resolved window |
| `analytics timeseries` | `--from`, `--to`, `--granularity`, `--platform` | Table plus a views sparkline |
| `analytics breakdown` | `--from`, `--to` | `--platform` is a usage error here; the API ignores it |
| `analytics posts` | `--sort-by`, `--page`, `--limit`, `--all`, `--platform` | |
| `analytics top` | `--sort-by`, `--limit` | |
| `analytics discovered` | `--limit` | |
| `analytics sync-status` | | Per-account sync and discovery state |
| `analytics sync` | `--wait` | One run per workspace per ten minutes |

### ai

| Command | Key flags | Notes |
|---|---|---|
| `ai caption` | `--prompt`, `--platform`, `--refine`, `--partial` | Caption text goes to stdout alone so it pipes into `post create -t -` |
| `ai image` | `--prompt`, `--aspect`, `--model`, `--quality`, `--reference`, `--wait`, `-o/--output` | |
| `ai image get <jobId>` | `--wait`, `-o/--output` | |

Insufficient credits come back as exit 9, not a generic failure.

### Everywhere else

| Command | Key flags | Notes |
|---|---|---|
| `login` | `--token-stdin`, `--profile`, `--api-url`, `--name` | |
| `logout` | `--profile`, `--all` | |
| `whoami` | | Prints which source each of the token and the API URL came from |
| `config list \| get \| set \| unset \| path` | | Reads and writes `config.json` |
| `open [what] [id]` | | `dashboard`, `post <id>`, `accounts`, `analytics`, `tokens`, `webhooks` |
| `doctor` | `--json` | Node version, files, permissions, token, API reachability, rate limit |
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

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure, including 5xx |
| 2 | Usage error: bad flag, missing argument, unknown enum, prompt needed under `--no-input` |
| 3 | Auth failure: 401, 403, missing or malformed token |
| 4 | Not found: 404 |
| 5 | Validation or other 400 |
| 6 | Conflict: 409 |
| 7 | Rate limited: 429 after retries |
| 8 | Network failure or timeout |
| 9 | Quota or plan limit: 402, insufficient credits |
| 130 | Interrupted with Ctrl-C |

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
| `updateCheck` | Set false to turn off the daily version check |

```bash
adaptlypost config set timezone Europe/Berlin
adaptlypost config set defaultPlatforms TWITTER,LINKEDIN
adaptlypost config list
adaptlypost config path
```

Run `adaptlypost doctor` when something is off. It checks the Node version, both files and their permissions, the token, API reachability and latency, the OpenAPI document, the rate-limit budget and any proxy variables, and prints the fix for each failure. It exits 1 when any check fails and supports `--json`.

## Environment variables

| Variable | Meaning |
|---|---|
| `ADAPTLYPOST_API_TOKEN` | API token. Read first |
| `ADAPTLYPOST_API_KEY` | Same thing, accepted for compatibility with the MCP server and skills |
| `ADAPTLYPOST_API_URL` | Base URL. Defaults to `https://post.adaptlypost.com/post/api/v1` |
| `ADAPTLYPOST_PROFILE` | Profile name |
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
