# vibe-bridge-sdk

A small SDK that bridges a WebSocket peer to a [Claude Code](https://claude.com/claude-code) session via the [Model Context Protocol](https://modelcontextprotocol.io/). Inbound WebSocket frames surface to the model as `<channel>` tags; the model replies by calling a `reply` tool that pushes a frame back over the socket.

## Packages

| Package | Description |
| --- | --- |
| [`@vibeus/bridge-contracts`](./packages/contracts) | Shared frame types (`ChannelInboundFrame`, `ChannelOutboundFrame`). Pure types, no runtime. |
| [`@vibeus/claude-code-channel`](./packages/claude-code-channel) | MCP stdio server that connects a WebSocket peer to a Claude Code session. |

## Requirements

- [Bun](https://bun.sh) 1.3.11+

## Quick start

```sh
bun install
bun packages/claude-code-channel/channel.ts
```

Configure the bridge with environment variables:

- `WEBSOCKET_URL` — peer to connect to (default `ws://localhost:8080`)
- `WEBSOCKET_RECONNECT_MS` — reconnect backoff (default `2000`)

To register the bridge as an MCP server for Claude Code itself, add it to `.mcp.json` (gitignored — local only):

```json
{
  "mcpServers": {
    "websocket-bridge": {
      "command": "bun",
      "args": ["packages/claude-code-channel/channel.ts"],
      "env": { "WEBSOCKET_URL": "ws://localhost:8080" }
    }
  }
}
```

## Development

- `bun run check` — Biome lint + format check
- `bun run check:fix` — Biome lint/format with autofix
- `bun run typecheck` — `tsc --noEmit` across the workspace

See [CLAUDE.md](./CLAUDE.md) for stack details, architecture, the bridge protocol contract, and the release procedure for `@vibeus/bridge-contracts`. AI agents should also see [AGENTS.md](./AGENTS.md).

## License

[MIT](./LICENSE)
