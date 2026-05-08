import {
  createAccountListHelpers,
  normalizeAccountId,
} from "openclaw/plugin-sdk/account-resolution";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { runPassiveAccountLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { createChatChannelPlugin, type OpenClawConfig } from "openclaw/plugin-sdk/core";
import { createPatchedAccountSetupAdapter } from "openclaw/plugin-sdk/setup";
import { startBridgeMonitor } from "./monitor.js";
import { getBridgeRuntime } from "./runtime.js";

export type BridgeAccountConfig = {
  enabled?: boolean;
  pat?: string;
  event_type?: string;
  bridge_url?: string;
  backend?: string;
  reconnect_ms?: number;
};

export type ResolvedBridgeAccount = {
  accountId: string;
  enabled: boolean;
  config: BridgeAccountConfig;
};

const DEFAULT_BRIDGE_URL = "wss://bridge.vibe.us";
const DEFAULT_RECONNECT_MS = 2000;

const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("vibe-bridge");

function resolveBridgeAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedBridgeAccount {
  const accountId = normalizeAccountId(params.accountId);
  const channelConfig = (params.cfg.channels?.["vibe-bridge"] ?? {}) as BridgeAccountConfig;
  const enabled = channelConfig.enabled !== false;

  return {
    accountId,
    enabled,
    config: {
      pat: channelConfig.pat,
      event_type: channelConfig.event_type,
      bridge_url: channelConfig.bridge_url,
      backend: channelConfig.backend,
      reconnect_ms: channelConfig.reconnect_ms,
    },
  };
}

// Setup wizard / `channels add` map credential-bag fields onto channel config:
//   token    -> pat
//   audience -> event_type   (defaults to DEFAULT_EVENT_TYPE if not provided —
//                             openclaw 2026.5.x doesn't expose --audience as a CLI
//                             flag for externally-installed plugins, so the
//                             non-interactive `--token` flow relies on this default)
//   baseUrl  -> bridge_url
// Edit `openclaw.json` directly for `backend` (dev-only) and `reconnect_ms`.
const DEFAULT_EVENT_TYPE = "memo";

const bridgeSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: "vibe-bridge",
  buildPatch: (input) => {
    const patch: Record<string, unknown> = {
      event_type: input.audience ?? DEFAULT_EVENT_TYPE,
    };
    if (input.token) {
      patch.pat = input.token;
    }
    if (input.baseUrl) {
      patch.bridge_url = input.baseUrl;
    }
    return patch;
  },
});

const bridgeConfigAdapter = createScopedChannelConfigAdapter<ResolvedBridgeAccount>({
  sectionKey: "vibe-bridge",
  listAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveBridgeAccount),
  defaultAccountId: resolveDefaultAccountId,
  clearBaseFields: ["pat", "event_type", "bridge_url", "backend", "reconnect_ms"],
  resolveAllowFrom: () => null,
  formatAllowFrom: () => [],
});

export const bridgePlugin = createChatChannelPlugin({
  base: {
    id: "vibe-bridge",
    meta: {
      id: "vibe-bridge",
      label: "Vibe Bridge",
      blurb: "Two-way channel that bridges OpenClaw to the Vibe WebSocket bridge.",
      order: 100,
      selectionLabel: "Vibe Bridge",
      docsPath: "/channels/vibe-bridge",
    },
    setup: bridgeSetupAdapter,
    capabilities: {
      chatTypes: ["direct"],
      nativeCommands: true,
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.vibe-bridge"] },
    config: {
      ...bridgeConfigAdapter,
      isConfigured: (account) => Boolean(account.config.pat) && Boolean(account.config.event_type),
      describeAccount: (account) => ({
        accountId: account.accountId,
        enabled: account.enabled,
        configured: Boolean(account.config.pat) && Boolean(account.config.event_type),
      }),
    },
    gateway: {
      startAccount: async (ctx) => {
        const account = ctx.account;
        const { pat, event_type } = account.config;
        if (!pat || !event_type) {
          ctx.log?.warn(
            `[${account.accountId}] missing pat or event_type, skipping Vibe Bridge monitor`,
          );
          return;
        }

        ctx.log?.info(`[${account.accountId}] starting Vibe Bridge WebSocket monitor`);
        const runtime = getBridgeRuntime();

        await runPassiveAccountLifecycle({
          abortSignal: ctx.abortSignal,
          start: async () => {
            void startBridgeMonitor({
              pat,
              eventType: event_type,
              bridgeUrl: account.config.bridge_url ?? DEFAULT_BRIDGE_URL,
              backend: account.config.backend,
              reconnectMs: account.config.reconnect_ms ?? DEFAULT_RECONNECT_MS,
              accountId: account.accountId,
              config: ctx.cfg,
              runtime,
              abortSignal: ctx.abortSignal,
              log: (msg) => ctx.log?.info(msg),
              error: (msg) => ctx.log?.error(msg),
            });
            return undefined;
          },
        });
      },
    },
  },
});
