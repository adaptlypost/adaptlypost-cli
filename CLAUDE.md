# AdaptlyPost CLI

Command line interface for the AdaptlyPost social media scheduling platform. Bins: `adaptlypost`, `apost`.

## Setup

1. Get an API token from https://adaptlypost.com/api-tokens
2. `adaptlypost login`, or set `ADAPTLYPOST_API_TOKEN`
3. Talks to one host only: `https://post.adaptlypost.com/post/api/v1`

## Architecture

- `src/cli.ts` — shebang, program assembly, global flags, dispatch
- `src/core/` — config, credentials, http, output, table, poll and friends; byte-identical in all three CLI repos, synced with `npm run sync-core`
- `src/api/` — one typed method per REST endpoint
- `src/commands/` — one file per top-level noun, lazy-imported from the action handler
- No LLM call, no prompt, no provider key here; `ai` commands post to the API and the model runs behind it

## Build & Run

```bash
npm install
npm run build        # tsdown bundles src/cli.ts to dist/cli.js
node dist/cli.js --version
npm run typecheck && npm test
```

Ship compiled JavaScript: `bin` points at `dist/cli.js` and never at `src/`. Pointing it at a `.ts` file needs Bun on the user's machine, and `npx @adaptlypost/cli` must run on Node alone. Bun is a build-time tool for `npm run compile` only. Releases are tagged `v1.2.3`, with the `v`.
