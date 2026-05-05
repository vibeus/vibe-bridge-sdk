# @vibeus/claude-code-channel

MCP stdio server that bridges a [vibe-bridge](https://github.com/vibeus/vibe-bridge) WebSocket subscription to a [Claude Code](https://claude.com/claude-code) session.

The CLI subscribes to `GET /channels/subscribe?event_type=...` on the bridge, authenticated with a Bearer personal access token (PAT). Inbound frames surface to the model as `<channel source="websocket-bridge" chat_id="...">` tags. The model replies by calling the `reply` tool with the `chat_id` and reply text — the server wraps it as an outbound frame and pushes it onto the socket.

## Usage

Register the bridge as an MCP server with Claude Code. Example `.mcp.json`:

```json
{
  "mcpServers": {
    "websocket-bridge": {
      "command": "npx",
      "args": ["-y", "@vibeus/claude-code-channel"],
      "env": {
        "VIBE_EVENT_TYPE": "memo",
        "VIBE_PAT": "vibe_pat_..."
      }
    }
  }
}
```

## Configuration

| Variable           | Required | Default                 | Description                                                                                  |
| ------------------ | :------: | ----------------------- | -------------------------------------------------------------------------------------------- |
| `VIBE_PAT`         |   yes    | —                       | Personal access token sent as `Authorization: Bearer <pat>` on the WebSocket upgrade.        |
| `VIBE_EVENT_TYPE`  |   yes    | —                       | Subscription channel name. The bridge derives `user_id` from the PAT.                        |
| `VIBE_BRIDGE_URL`  |    no    | `wss://bridge.vibe.us`  | Base URL of the bridge worker. The CLI appends `/channels/subscribe?event_type=...`.         |
| `VIBE_BACKEND`     |    no    | —                       | Set to `dev` to send `x-vibe-backend: dev` (opt into the dev-tier backend on dev deploys).   |
| `VIBE_RECONNECT_MS`|    no    | `2000`                  | Delay (ms) before reconnecting after the socket closes.                                      |

The CLI exits with a non-zero status if `VIBE_PAT` or `VIBE_EVENT_TYPE` is missing.

## Requirements

Node.js >= 22.

## Frame format

See [`@vibeus/bridge-contracts`](https://www.npmjs.com/package/@vibeus/bridge-contracts) for the inbound/outbound frame types exchanged over the socket.

## License

MIT
