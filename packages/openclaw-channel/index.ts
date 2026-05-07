import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { bridgePlugin } from "./src/channel.js";
import { setBridgeRuntime } from "./src/runtime.js";

export { bridgePlugin } from "./src/channel.js";
export { setBridgeRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "vibe-bridge",
  name: "Vibe Bridge",
  description: "OpenClaw channel plugin bridging the Vibe WebSocket bridge.",
  plugin: bridgePlugin as ChannelPlugin,
  setRuntime: setBridgeRuntime,
});
