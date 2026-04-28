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
- `bun run typecheck` — `tsc --noEmit` across the workspace

Run the WebSocket↔MCP bridge locally:

- `bun packages/claude-code-channel/channel.ts` (or `bun run --cwd packages/claude-code-channel start`)
- Configure with `WEBSOCKET_URL` (default `ws://localhost:8080`) and `WEBSOCKET_RECONNECT_MS` (default `2000`)

`.mcp.json` is gitignored and registers the bridge as the `websocket-bridge` MCP server for Claude Code itself — editing it changes how *this repo's* Claude Code session talks to the bridge.

## Architecture

Two workspace packages under `packages/`:

- **`@vibeus/bridge-contracts`** (`packages/contracts/`) — shared frame types only (`ChannelInboundFrame`, `ChannelOutboundFrame`). Pure types, no runtime. Re-exported via `./channel` subpath; consumed as `workspace:*`.
- **`@vibeus/claude-code-channel`** (`packages/claude-code-channel/`) — an MCP stdio server that bridges a WebSocket peer to a Claude Code session.

### How the bridge works

`channel.ts` runs two concurrent transports:

1. **MCP stdio** to the host Claude Code process. Stdout is reserved for the MCP framing — **all logging must go to stderr** (`console.error`), or the MCP transport will desync.
2. **WebSocket** client to a remote peer, with auto-reconnect on close.

Inbound WS frames (`ChannelInboundFrame`) are forwarded to the host as `notifications/claude/channel` MCP notifications. The host surfaces them as `<channel source="websocket-bridge" chat_id="...">` tags; `frame.id` becomes `chat_id`, and any `frame.meta` keys become extra tag attributes. The model replies by calling the `reply` tool with that `chat_id` plus reply text — the server wraps it in a `ChannelOutboundFrame` (with `reply_to: chat_id`, fresh `id`, `ts`) and pushes it onto the WS.

The `experimental: { "claude/channel": {} }` capability and the `notifications/claude/channel` method are non-standard MCP — they are the contract this bridge has with the Claude Code host. Don't rename them without updating both sides.

## CI

`.github/workflows/ci.yml` runs `bun run check` and `bun run typecheck` on push/PR to `main`, pinned to the same Bun version used locally.
