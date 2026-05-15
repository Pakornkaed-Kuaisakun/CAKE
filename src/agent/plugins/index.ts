// src/agent/plugins/index.ts
export { loadAllPlugins, PLUGINS_DIR } from "./loader.js";
export {
  registerPlugins,
  getPlugins,
  isInitialized,
  getPluginIntentMap,
  getPluginRoutes,
  getPluginCommands,
  findPluginHandler,
  matchPluginRoute,
} from "./registry.js";
export type { Plugin, LoadedPlugin, PluginHandler } from "./types.js";
