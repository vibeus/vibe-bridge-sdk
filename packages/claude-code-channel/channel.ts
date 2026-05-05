#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ChannelInboundFrame, ChannelOutboundFrame } from "@vibeus/bridge-contracts/channel";
import WebSocket from "ws";

// stderr only — stdout is reserved for the MCP transport
const log = (...args: unknown[]) => console.error("[ws-channel]", ...args);

const BRIDGE_URL = process.env.VIBE_BRIDGE_URL ?? "wss://bridge.vibe.us";
const EVENT_TYPE = process.env.VIBE_EVENT_TYPE;
const PAT = process.env.VIBE_PAT;
const BACKEND = process.env.VIBE_BACKEND;
const RECONNECT_MS = Number(process.env.VIBE_RECONNECT_MS ?? 2000);

if (!EVENT_TYPE) {
  log("VIBE_EVENT_TYPE is required");
  process.exit(1);
}
if (!PAT) {
  log("VIBE_PAT is required (Bearer personal access token)");
  process.exit(1);
}

const subscribeUrl = (() => {
  const u = new URL(BRIDGE_URL);
  u.pathname = "/channels/subscribe";
  u.searchParams.set("event_type", EVENT_TYPE);
  return u.toString();
})();

const headers: Record<string, string> = {
  authorization: `Bearer ${PAT}`,
};
if (BACKEND) {
  headers["x-vibe-backend"] = BACKEND;
}

const mcp = new Server(
  { name: "websocket-bridge", version: "0.0.1" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions:
      'Messages from the websocket bridge arrive as <channel source="websocket-bridge" chat_id="..."> tags. ' +
      "To respond, call the `reply` tool with the chat_id from the tag and your message text. " +
      "Inbound `content` is the raw frame body; any other tag attributes come from the sender as routing metadata.",
  },
);

let ws: WebSocket | null = null;
let connected = false;

function connect() {
  log("connecting to", subscribeUrl);
  const sock = new WebSocket(subscribeUrl, { headers });
  sock.binaryType = "arraybuffer";
  ws = sock;

  sock.addEventListener("open", () => {
    connected = true;
    log("connected");
  });

  sock.addEventListener("message", async (ev) => {
    const raw =
      typeof ev.data === "string"
        ? ev.data
        : ev.data instanceof ArrayBuffer
          ? new TextDecoder().decode(ev.data)
          : Buffer.isBuffer(ev.data)
            ? ev.data.toString("utf8")
            : null;
    if (raw === null) {
      log("dropped message with unsupported data type");
      return;
    }

    let frame: ChannelInboundFrame;
    try {
      frame = JSON.parse(raw) as ChannelInboundFrame;
    } catch (err) {
      log("failed to parse inbound frame", err);
      return;
    }

    const meta: Record<string, string> = { chat_id: frame.id };
    if (frame.meta) {
      for (const [k, v] of Object.entries(frame.meta)) {
        if (v == null) {
          continue;
        }
        meta[k] = String(v);
      }
    }

    try {
      await mcp.notification({
        method: "notifications/claude/channel",
        params: { content: frame.content.text, meta },
      });
    } catch (err) {
      log("failed to forward message", err);
    }
  });

  sock.addEventListener("close", (ev) => {
    connected = false;
    log(
      `closed (code=${ev.code}${ev.reason ? `, reason=${ev.reason}` : ""}); reconnecting in ${RECONNECT_MS}ms`,
    );
    setTimeout(connect, RECONNECT_MS);
  });

  sock.addEventListener("error", (ev) => {
    log("error", (ev as { message?: string }).message ?? ev);
  });

  // ws-specific event surfaces the HTTP response when the upgrade is rejected
  // (e.g. 401 from invalid PAT). The DOM-style "error"/"close" alone don't
  // expose the status code.
  sock.on("unexpected-response", (_req, res) => {
    log(`handshake rejected: ${res.statusCode} ${res.statusMessage ?? ""}`.trim());
  });
}

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a message back through the websocket channel. Use the chat_id from the inbound <channel> tag so the remote sender can route the reply.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: {
            type: "string",
            description: "The chat_id attribute from the inbound <channel> tag.",
          },
          text: {
            type: "string",
            description: "The message text to send to the websocket peer.",
          },
        },
        required: ["chat_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "reply") {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const { chat_id, text } = req.params.arguments as { chat_id: string; text: string };

  if (!ws || !connected || ws.readyState !== WebSocket.OPEN) {
    return {
      content: [{ type: "text", text: "reply failed: websocket not connected" }],
      isError: true,
    };
  }

  const frame: ChannelOutboundFrame = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    reply_to: chat_id,
    content: { text },
  };
  ws.send(JSON.stringify(frame));
  return { content: [{ type: "text", text: "sent" }] };
});

await mcp.connect(new StdioServerTransport());
connect();
