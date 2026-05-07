import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { bridgePlugin } from "./src/channel.js";

export default defineSetupPluginEntry(bridgePlugin);
