import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setBridgeRuntime, getRuntime: getBridgeRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Vibe Bridge runtime not initialized");

export { getBridgeRuntime, setBridgeRuntime };
