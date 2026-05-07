# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Bun workspaces monorepo. TypeScript with `verbatimModuleSyntax` and `allowImportingTsExtensions` (no build step — Bun runs `.ts` directly). Biome for lint/format. No test framework wired up yet.

## Commands

Run from the repo root:

- `bun install` — install workspace dependencies
- `bun run check` — Biome lint + format check (CI gate)
- `bun run check:fix` — Biome lint/format with autofix
- `bun run format` — Biome format only
- `bun run typecheck` — `tsc --noEmit` across the workspace, then `tsc --noEmit` inside `packages/openclaw-channel` (which uses its own NodeNext tsconfig — see Architecture)

Run the WebSocket↔MCP bridge locally:

- `bun packages/claude-code-channel/channel.ts` (or `bun run --cwd packages/claude-code-channel start`)
- Required env: `VIBE_PAT` (Bearer PAT for the bridge), `VIBE_EVENT_TYPE` (subscription channel name).
- Optional env: `VIBE_BRIDGE_URL` (default `wss://bridge.vibe.us` — the prod [vibe-bridge](https://github.com/vibeus/vibe-bridge) worker; point at `ws://localhost:8787` to talk to a local `wrangler dev`), `VIBE_BACKEND` (set to `dev` to add `x-vibe-backend: dev`), `VIBE_RECONNECT_MS` (default `2000`).

`.mcp.json` is gitignored and registers the bridge as the `websocket-bridge` MCP server for Claude Code itself — editing it changes how *this repo's* Claude Code session talks to the bridge.

## Architecture

Three workspace packages under `packages/`:

- **`@vibeus/bridge-contracts`** (`packages/contracts/`) — shared frame types only (`ChannelInboundFrame`, `ChannelOutboundFrame`). Pure types, no runtime. Re-exported via `./channel` subpath; consumed as `workspace:*`.
- **`@vibeus/claude-code-channel`** (`packages/claude-code-channel/`) — an MCP stdio server that bridges a WebSocket peer to a Claude Code session.
- **`@vibeus/openclaw-channel`** (`packages/openclaw-channel/`) — an OpenClaw channel plugin (in-process, loaded by the OpenClaw host as TypeScript source) that surfaces the same WebSocket+frame protocol as `@vibeus/claude-code-channel`. Private workspace package; not currently published.

### Dual tsconfig setup

The repo root `tsconfig.json` uses `moduleResolution: bundler` + `allowImportingTsExtensions: true` (Bun-native). That works for `contracts/` and `claude-code-channel/` but conflicts with OpenClaw's NodeNext loader, which requires `.js` extensions on relative imports of `.ts` files. So `packages/openclaw-channel/` has its own `tsconfig.json` with `module/moduleResolution: NodeNext`, and the root `tsconfig.json` excludes it under `exclude: ["packages/openclaw-channel/**"]`. The root `typecheck` script chains `bun run --cwd packages/openclaw-channel typecheck` to keep CI coverage.

### How the bridge works

`channel.ts` runs two concurrent transports:

1. **MCP stdio** to the host Claude Code process. Stdout is reserved for the MCP framing — **all logging must go to stderr** (`console.error`), or the MCP transport will desync.
2. **WebSocket** client to the [vibe-bridge](https://github.com/vibeus/vibe-bridge) worker. The CLI builds the URL from `VIBE_BRIDGE_URL` + `/channels/subscribe?event_type=${VIBE_EVENT_TYPE}` and authenticates with `Authorization: Bearer ${VIBE_PAT}` on the upgrade request. The bridge derives `user_id` from the PAT — the client never sends it. Auto-reconnects on close.

The `ws` package is used (not the Node global `WebSocket`) because only `ws` exposes the per-request `headers` option needed for the Bearer auth. Handshake rejections (e.g. 401 from an invalid PAT) surface via the ws-specific `unexpected-response` event, which logs the HTTP status before `close` fires and the reconnect timer kicks in.

Inbound WS frames (`ChannelInboundFrame`) are forwarded to the host as `notifications/claude/channel` MCP notifications. The host surfaces them as `<channel source="websocket-bridge" chat_id="...">` tags; `frame.id` becomes `chat_id`, and any `frame.meta` keys become extra tag attributes (the bridge always populates `meta.user_id` and `meta.event_type`). The model replies by calling the `reply` tool with that `chat_id` plus reply text — the server wraps it in a `ChannelOutboundFrame` (with `reply_to: chat_id`, fresh `id`, `ts`) and pushes it onto the WS.

The `experimental: { "claude/channel": {} }` capability and the `notifications/claude/channel` method are non-standard MCP — they are the contract this bridge has with the Claude Code host. Don't rename them without updating both sides.

### How `@vibeus/openclaw-channel` works

OpenClaw plugins are not separate processes — the host imports the plugin's TypeScript directly. `index.ts` registers the plugin via `defineChannelPluginEntry` (channel id `vibe-bridge`); `setup-entry.ts` exposes the same plugin to OpenClaw's `channels add` CLI via `defineSetupPluginEntry`; `src/runtime.ts` holds the `PluginRuntime` singleton; `src/channel.ts` wires the OpenClaw config/setup adapters; `src/monitor.ts` runs the WebSocket loop.

`src/monitor.ts` mirrors `claude-code-channel/channel.ts` — same URL shape (`${bridge_url}/channels/subscribe?event_type=...`), same `Authorization: Bearer ${pat}` + optional `x-vibe-backend` headers, same `unexpected-response` handling, same auto-reconnect — but instead of forwarding frames as MCP notifications it calls `dispatchInboundDirectDmWithRuntime` from `openclaw/plugin-sdk/direct-dm`. Each inbound `ChannelInboundFrame` becomes an OpenClaw direct DM (`messageId = frame.id`, `senderId = frame.meta.user_id ?? frame.id`, `frame.meta` flattened to strings into `extraContext`). The `deliver` callback closes over the inbound `frame.id` and the live `WebSocket`, wrapping the agent's reply into a `ChannelOutboundFrame` (`reply_to: frame.id`, fresh `id`/`ts`).

Configuration mapping (`@vibeus/claude-code-channel` env var → `channels.vibe-bridge.<key>` in `openclaw.json`): `VIBE_PAT` → `pat`, `VIBE_EVENT_TYPE` → `event_type`, `VIBE_BRIDGE_URL` → `bridge_url`, `VIBE_BACKEND` → `backend`, `VIBE_RECONNECT_MS` → `reconnect_ms`. The setup wizard accepts `token`/`audience`/`baseUrl` from `ChannelSetupInput` and patches them into `pat`/`event_type`/`bridge_url`; `backend` and `reconnect_ms` require editing `openclaw.json` directly.

## CI

`.github/workflows/ci.yml` runs `bun run check` and `bun run typecheck` on push/PR to `main`, pinned to the same Bun version used locally.

## Releasing `@vibeus/bridge-contracts`

The in-tree `packages/contracts/package.json` keeps source-pointing `exports` (`./index.ts`, `./channel.ts`) so Bun + tsc work with no build step. The published artifact is a separately-prepared bundle under `packages/contracts/dist/` with a rewritten `package.json` and compiled `.js`/`.d.ts`.

Build pipeline:

- `bun run --cwd packages/contracts build` — `tsc -p tsconfig.build.json` emits `.js` + `.d.ts` (+ sourcemaps) to `dist/`. Uses `rewriteRelativeImportExtensions` so `./channel.ts` becomes `./channel.js` on emit. Source files therefore use explicit `.ts` extensions on relative imports.
- `bun run --cwd packages/contracts prepare-publish` — runs build, then `scripts/prepare-publish.ts` writes a publish-ready `dist/package.json` (exports point at compiled files) and patches any leftover `./*.ts` references in emitted `.d.ts` files to `./*.js` (tsc 6.0.3 doesn't rewrite declaration emit).
- Always publish from `packages/contracts/dist/` — never from the package root, which still points at source.

Release procedure (run by Claude on request):

1. Bump `packages/contracts/package.json` `"version"` (semver).
2. Commit the bump as `chore(contracts): release vX.Y.Z` and push to `main`.
3. Tag: `git tag contracts-vX.Y.Z && git push origin contracts-vX.Y.Z`. The tag version must match `package.json`; the workflow verifies and fails otherwise.
4. `.github/workflows/release-contracts.yml` builds, prepares the bundle, and runs `npm publish --provenance --access public` from `dist/`. Auth is via npm trusted publisher (OIDC) — the workflow only needs `id-token: write` (already set on the job), which doubles as the provenance signal. No `NPM_TOKEN` required.
5. To dry-run without tagging: trigger the workflow manually with `dry-run: true` (`gh workflow run release-contracts.yml -f dry-run=true`).

Do not bump or tag without the user's explicit go-ahead — releases are user-triggered.

## Releasing `@vibeus/claude-code-channel`

The channel ships as an executable CLI on npm, runnable via `npx -y @vibeus/claude-code-channel` (bin name: `claude-code-channel`). The in-tree `packages/claude-code-channel/package.json` still uses `bun ./channel.ts` for dev — the published bundle in `packages/claude-code-channel/dist/` has its shebang rewritten to `#!/usr/bin/env node` so it runs under plain Node.

Notes:

- Requires Node >= 22 at runtime (the CLI relies on the global `WebSocket`, stable in Node 22+). This is enforced via `engines.node` in the published `package.json`.
- The source uses an `import type` from `@vibeus/bridge-contracts/channel`; with `verbatimModuleSyntax` it erases at compile time, so contracts is a `devDependency` only — the published package has just `@modelcontextprotocol/sdk` at runtime.
- No declaration emit (CLI, not a library). `tsconfig.build.json` sets `declaration: false`.

Build pipeline:

- `bun run --cwd packages/claude-code-channel build` — `tsc -p tsconfig.build.json` emits `dist/channel.js`.
- `bun run --cwd packages/claude-code-channel prepare-publish` — runs build, then `scripts/prepare-publish.ts` rewrites the `#!/usr/bin/env bun` shebang to `#!/usr/bin/env node`, `chmod +x`'s `dist/channel.js`, and writes a publish-ready `dist/package.json` with `bin`, `engines`, runtime `dependencies`, and `files`.
- Always publish from `packages/claude-code-channel/dist/` — never from the package root, which still uses `bun` for dev.

Release procedure (run by Claude on request):

1. Bump `packages/claude-code-channel/package.json` `"version"` (semver).
2. Commit the bump as `chore(channel): release vX.Y.Z` and push to `main`.
3. Tag: `git tag claude-code-channel-vX.Y.Z && git push origin claude-code-channel-vX.Y.Z`. The tag version must match `package.json`; the workflow verifies and fails otherwise.
4. `.github/workflows/release-claude-code-channel.yml` builds, prepares the bundle, and runs `npm publish --provenance --access public` from `dist/`. Auth is via npm trusted publisher (OIDC); only `id-token: write` is needed.
5. To dry-run without tagging: `gh workflow run release-claude-code-channel.yml -f dry-run=true`.

Do not bump or tag without the user's explicit go-ahead — releases are user-triggered.

## Releasing `@vibeus/openclaw-channel`

Not currently published. The package is `private: true` in `package.json` and has no build step or release workflow — OpenClaw loads the TypeScript source directly. Distribution is expected to happen via local path or git URL (e.g. `openclaw plugins add <path>`) rather than npm. If we ever want to publish, model the build/release pipeline on `@vibeus/claude-code-channel` (CLI release), not on `@vibeus/bridge-contracts` (library release) — but that decision should come from the user.
