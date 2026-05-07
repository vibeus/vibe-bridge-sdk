# vibe-bridge-sdk

A small SDK for bridging the [vibe-bridge](https://github.com/vibeus/vibe-bridge) WebSocket relay to AI agents. Inbound WebSocket frames surface to the agent as messages from a peer; the agent replies, and the reply is pushed back over the socket as a frame with `reply_to` set to the originating message id.

Two consumers ship today:

- [Claude Code](https://claude.com/claude-code), via an MCP stdio server (`@vibeus/claude-code-channel`)
- [OpenClaw](https://github.com/vibeus/openclaw), via an in-process channel plugin (`@vibeus/openclaw-channel`)

Both speak the same wire protocol, defined by the shared frame types in `@vibeus/bridge-contracts`.

## Packages

| Package | Description |
| --- | --- |
| [`@vibeus/bridge-contracts`](./packages/contracts) | Shared frame types (`ChannelInboundFrame`, `ChannelOutboundFrame`). Pure types, no runtime. |
| [`@vibeus/claude-code-channel`](./packages/claude-code-channel) | MCP stdio server that connects a WebSocket peer to a Claude Code session. Published to npm. |
| [`@vibeus/openclaw-channel`](./packages/openclaw-channel) | OpenClaw channel plugin (`vibe-bridge`) that delivers inbound frames as direct DMs and emits the agent's replies back over the socket. Private workspace package. |

## Requirements

- [Bun](https://bun.sh) 1.3.11+

## Quick start — Claude Code

```sh
bun install
VIBE_PAT=<bearer-pat> VIBE_EVENT_TYPE=<event-type> bun packages/claude-code-channel/channel.ts
```

Configure the bridge with environment variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VIBE_PAT` | yes | — | Bearer personal access token for the bridge |
| `VIBE_EVENT_TYPE` | yes | — | Subscription channel name (passed as `?event_type=`) |
| `VIBE_BRIDGE_URL` | no | `wss://bridge.vibe.us` | Bridge base URL; point at `ws://localhost:8787` for a local `wrangler dev` |
| `VIBE_BACKEND` | no | — | Set to `dev` to add `x-vibe-backend: dev` |
| `VIBE_RECONNECT_MS` | no | `2000` | Reconnect delay after socket close |

To register the bridge as an MCP server for Claude Code itself, add it to `.mcp.json` (gitignored — local only):

```json
{
  "mcpServers": {
    "websocket-bridge": {
      "command": "bun",
      "args": ["packages/claude-code-channel/channel.ts"],
      "env": {
        "VIBE_PAT": "<bearer-pat>",
        "VIBE_EVENT_TYPE": "<event-type>"
      }
    }
  }
}
```

## Quick start — OpenClaw

`@vibeus/openclaw-channel` is loaded in-process by the OpenClaw host. Build the compiled JS twin (required by `openclaw@2026.5.x`'s installer; `dist/` is gitignored) and install it as a plugin in your OpenClaw checkout:

```sh
bun install
bun run --cwd packages/openclaw-channel build
openclaw plugins add <path-to-packages/openclaw-channel>
```

Then configure the `vibe-bridge` channel in `openclaw.json`:

```json
{
  "channels": {
    "vibe-bridge": {
      "pat": "<bearer-pat>",
      "event_type": "<event-type>"
    }
  }
}
```

Or via the CLI:

```sh
openclaw channels add --channel vibe-bridge --token "<bearer-pat>" --audience "<event-type>"
```

See [`packages/openclaw-channel/README.md`](./packages/openclaw-channel/README.md) for the full config schema (including `bridge_url`, `backend`, `reconnect_ms`) and the env-var equivalence table to `@vibeus/claude-code-channel`.

## Development

- `bun run check` — Biome lint + format check
- `bun run check:fix` — Biome lint/format with autofix
- `bun run typecheck` — `tsc --noEmit` across the workspace, then `tsc --noEmit` inside `packages/openclaw-channel` (which uses its own NodeNext tsconfig because OpenClaw's loader requires `.js` extensions on relative imports — see CLAUDE.md)

See [CLAUDE.md](./CLAUDE.md) for stack details, architecture, the bridge protocol contract, and the release procedures for `@vibeus/bridge-contracts` and `@vibeus/claude-code-channel`. AI agents should also see [AGENTS.md](./AGENTS.md).

## License

[MIT](./LICENSE)
