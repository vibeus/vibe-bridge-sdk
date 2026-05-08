# vibe-bridge

OpenClaw channel plugin that bridges OpenClaw agents to the [vibe-bridge](https://github.com/vibeus/vibe-bridge) WebSocket relay.

This is a **two-way** channel — inbound frames from the bridge become OpenClaw direct DMs, and the agent's reply is sent back over the same WebSocket with `reply_to` set to the inbound frame id.

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

| Key            | Required | Default                | Description                                                              |
| -------------- | -------- | ---------------------- | ------------------------------------------------------------------------ |
| `pat`          | yes      | —                      | Bearer personal access token for the bridge                              |
| `event_type`   | yes      | —                      | Subscription channel name (sent as the `?event_type=` query parameter)   |
| `bridge_url`   | no       | `wss://bridge.vibe.us` | Bridge base URL; point at `ws://localhost:8787` for a local bridge       |
| `backend`      | no       | (omitted)              | Set to `dev` to add an `x-vibe-backend: dev` header on the upgrade       |
| `reconnect_ms` | no       | `2000`                 | Delay before reconnecting after the socket closes                        |
| `enabled`      | no       | `true`                 | Set to `false` to disable the channel                                    |

Or non-interactively via the CLI:

```sh
openclaw channels add --channel vibe-bridge --token "<pat>"
```

`--token` populates `pat`, and `event_type` defaults to `memo` when not otherwise set. To use a different `event_type`, run `openclaw channels add` with no flags to launch the interactive wizard (it prompts for `token`/`audience`/`baseUrl`, mapped onto `pat`/`event_type`/`bridge_url`), or edit `openclaw.json` directly. `backend` and `reconnect_ms` always require a manual edit.

> Note: openclaw 2026.5.x only registers custom CLI flags (e.g. `--audience`) for first-party bundled channels, so the non-interactive CLI cannot set `event_type` directly — that's why the plugin defaults it to `memo`.

## Wire format

Inbound frames (bridge → plugin):

```json
{
  "id": "<frame-id>",
  "ts": 1730000000000,
  "content": { "text": "<message>" },
  "meta": { "user_id": "<sender>", "event_type": "memo" }
}
```

Outbound frames (plugin → bridge), emitted when the agent replies:

```json
{
  "id": "<fresh-uuid>",
  "ts": 1730000000123,
  "reply_to": "<inbound frame id>",
  "content": { "text": "<reply>" }
}
```

## How it works

1. On startup, the plugin opens a WebSocket to `${bridge_url}/channels/subscribe?event_type=${event_type}` with `Authorization: Bearer ${pat}` (and `x-vibe-backend: ${backend}` when set).
2. Each inbound JSON frame is dispatched into OpenClaw as a direct DM via `dispatchInboundDirectDmWithRuntime`. `meta.user_id` becomes `senderId`; the rest of `meta` is flattened (string-coerced) into `extraContext`.
3. When the OpenClaw agent replies, the plugin emits an outbound frame with `reply_to` set to the inbound `frame.id` back over the same socket.
4. On socket close, the plugin reconnects after `reconnect_ms` until aborted.
5. Handshake failures (e.g. `401` from a bad PAT) surface via the `unexpected-response` event with the HTTP status; the plugin keeps retrying.
