# @vibeus/openclaw-channel

OpenClaw channel plugin that bridges OpenClaw agents to the [vibe-bridge](https://github.com/vibeus/vibe-bridge) WebSocket relay using the same wire protocol as [`@vibeus/claude-code-channel`](../claude-code-channel/).

This is a **two-way** channel — inbound `ChannelInboundFrame`s from the bridge become OpenClaw direct DMs, and the agent's reply is sent back as a `ChannelOutboundFrame` over the same WebSocket (`reply_to` is set to the inbound `frame.id`).

## Configuration

Add the following to your OpenClaw config (`openclaw.json`):

```json
{
  "channels": {
    "vibe-bridge": {
      "pat": "your-vibe-pat",
      "event_type": "memo",
      "bridge_url": "wss://bridge.vibe.us",
      "reconnect_ms": 2000,
      "enabled": true
    }
  }
}
```

| Bridge SDK env var (`@vibeus/claude-code-channel`) | OpenClaw config key | Required | Default                 |
| -------------------------------------------------- | ------------------- | -------- | ----------------------- |
| `VIBE_PAT`                                         | `pat`               | yes      | —                       |
| `VIBE_EVENT_TYPE`                                  | `event_type`        | yes      | —                       |
| `VIBE_BRIDGE_URL`                                  | `bridge_url`        | no       | `wss://bridge.vibe.us`  |
| `VIBE_BACKEND`                                     | `backend`           | no       | (omitted)               |
| `VIBE_RECONNECT_MS`                                | `reconnect_ms`      | no       | `2000`                  |
| —                                                  | `enabled`           | no       | `true`                  |

Or via the CLI:

```sh
openclaw channels add --channel vibe-bridge --pat "<pat>" --event-type "<event-type>"
```

## How it works

1. On startup, the plugin opens a WebSocket to `${bridge_url}/channels/subscribe?event_type=${event_type}` with `Authorization: Bearer ${pat}` (and `x-vibe-backend: ${backend}` when set).
2. Each inbound JSON frame is parsed as a `ChannelInboundFrame` and dispatched into OpenClaw via `dispatchInboundDirectDmWithRuntime`. `frame.meta.user_id` becomes `senderId`; the rest of `frame.meta` is flattened into `extraContext`.
3. When the OpenClaw agent replies, the plugin emits a `ChannelOutboundFrame` (`id: uuid`, `ts: Date.now()`, `reply_to: <inbound frame.id>`, `content.text: <reply>`) back over the same socket.
4. On socket close, the plugin reconnects after `reconnect_ms` until aborted.
5. Handshake failures (e.g. 401 from a bad PAT) surface via `ws`'s `unexpected-response` event with the HTTP status; the plugin keeps retrying.
