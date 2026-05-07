import type { ChannelInboundFrame, ChannelOutboundFrame } from "@vibeus/bridge-contracts/channel";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/direct-dm";
import WebSocket, { type RawData } from "ws";

export type BridgeMonitorOptions = {
  pat: string;
  eventType: string;
  bridgeUrl: string;
  backend?: string;
  reconnectMs: number;
  accountId: string;
  config: OpenClawConfig;
  runtime: PluginRuntime;
  abortSignal: AbortSignal;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
};

export async function startBridgeMonitor(options: BridgeMonitorOptions): Promise<void> {
  const { abortSignal, reconnectMs, log, error } = options;

  while (!abortSignal.aborted) {
    try {
      await runOneConnection(options);
    } catch (err) {
      if (abortSignal.aborted) {
        break;
      }
      error?.(`[vibe-bridge] connection error: ${stringifyError(err)}`);
    }
    if (abortSignal.aborted) {
      break;
    }
    log?.(`[vibe-bridge] reconnecting in ${reconnectMs}ms`);
    await sleep(reconnectMs, abortSignal);
  }
}

function runOneConnection(options: BridgeMonitorOptions): Promise<void> {
  const {
    pat,
    eventType,
    bridgeUrl,
    backend,
    accountId,
    config,
    runtime,
    abortSignal,
    log,
    error,
  } = options;

  const url = (() => {
    const u = new URL(bridgeUrl);
    u.pathname = "/channels/subscribe";
    u.searchParams.set("event_type", eventType);
    return u.toString();
  })();

  const headers: Record<string, string> = {
    authorization: `Bearer ${pat}`,
  };
  if (backend) {
    headers["x-vibe-backend"] = backend;
  }

  return new Promise<void>((resolve, reject) => {
    log?.(`[vibe-bridge] [${accountId}] connecting to ${url}`);
    const ws = new WebSocket(url, { headers });
    ws.binaryType = "arraybuffer";

    let settled = false;
    const settle = (err?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      abortSignal.removeEventListener("abort", onAbort);
      if (err !== undefined) {
        reject(err);
      } else {
        resolve();
      }
    };

    const onAbort = () => {
      try {
        ws.close(1000, "shutdown");
      } catch {
        // best effort
      }
      settle();
    };

    if (abortSignal.aborted) {
      onAbort();
      return;
    }
    abortSignal.addEventListener("abort", onAbort, { once: true });

    ws.on("open", () => {
      log?.(`[vibe-bridge] [${accountId}] connected`);
    });

    ws.on("message", (data: RawData, isBinary: boolean) => {
      const raw = decodeMessage(data, isBinary);
      if (raw === null) {
        log?.("[vibe-bridge] dropped message with unsupported data type");
        return;
      }

      let frame: ChannelInboundFrame;
      try {
        frame = JSON.parse(raw) as ChannelInboundFrame;
      } catch (err) {
        error?.(`[vibe-bridge] failed to parse inbound frame: ${stringifyError(err)}`);
        return;
      }

      void dispatchFrame({
        frame,
        ws,
        accountId,
        config,
        runtime,
        log,
        error,
      });
    });

    ws.on("close", (code, reason) => {
      const reasonStr = reason?.toString("utf8") ?? "";
      log?.(
        `[vibe-bridge] [${accountId}] closed (code=${code}${reasonStr ? `, reason=${reasonStr}` : ""})`,
      );
      settle();
    });

    ws.on("error", (err) => {
      error?.(`[vibe-bridge] [${accountId}] socket error: ${stringifyError(err)}`);
    });

    ws.on("unexpected-response", (_req, res) => {
      error?.(
        `[vibe-bridge] [${accountId}] handshake rejected: ${res.statusCode} ${res.statusMessage ?? ""}`.trim(),
      );
    });
  });
}

async function dispatchFrame(params: {
  frame: ChannelInboundFrame;
  ws: WebSocket;
  accountId: string;
  config: OpenClawConfig;
  runtime: PluginRuntime;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}): Promise<void> {
  const { frame, ws, accountId, config, runtime, log, error } = params;

  const senderId = (frame.meta?.user_id as string | undefined) ?? frame.id;
  const extraContext = flattenMeta(frame.meta);

  log?.(
    `[vibe-bridge] [${accountId}] inbound frame ${frame.id} from ${senderId}: ${frame.content.text.slice(0, 80)}`,
  );

  await dispatchInboundDirectDmWithRuntime({
    cfg: config,
    runtime,
    channel: "vibe-bridge",
    channelLabel: "Vibe Bridge",
    accountId,
    peer: { kind: "direct", id: senderId },
    senderId,
    senderAddress: `vibe-bridge:${senderId}`,
    recipientAddress: "vibe-bridge:openclaw",
    conversationLabel: senderId,
    rawBody: frame.content.text,
    messageId: frame.id,
    timestamp: frame.ts,
    commandAuthorized: true,
    provider: "vibe-bridge",
    surface: "vibe-bridge",
    extraContext,
    deliver: async (payload) => {
      const text = (payload as { text?: string }).text ?? "";
      const out: ChannelOutboundFrame = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        reply_to: frame.id,
        content: { text },
      };
      if (ws.readyState !== WebSocket.OPEN) {
        error?.(`[vibe-bridge] dropped reply for ${frame.id}: socket not open`);
        return;
      }
      ws.send(JSON.stringify(out));
    },
    onRecordError: (err) => {
      error?.(`[vibe-bridge] session record error: ${stringifyError(err)}`);
    },
    onDispatchError: (err, info) => {
      error?.(`[vibe-bridge] reply dispatch error (${info.kind}): ${stringifyError(err)}`);
    },
  });
}

function decodeMessage(data: RawData, isBinary: boolean): string | null {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (!isBinary) {
    return String(data);
  }
  return null;
}

function flattenMeta(meta: ChannelInboundFrame["meta"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!meta) {
    return out;
  }
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) {
      continue;
    }
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
