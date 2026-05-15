// Singleton registry that holds all loaded plugins and exposes
// helpers to inject them into the existing intentMap and router.
import type { LoadedPlugin } from "./types.js";
import type { Handler } from "../intentMap.js";

// Singeton state
let _plugins: LoadedPlugin[] = [];
let _initialized = false;

// Publish API
/** Called once at startup after loadPlugins() resolves. */
export function registerPlugins(plugins: LoadedPlugin[]): void {
  _plugins = plugins;
  _initialized = true;
}

/** Returns all loaded plugins. */
export function getPlugins(): LoadedPlugin[] {
  return _plugins;
}

/** Returns true if the registry has been initialised (even if 0 plugins). */
export function isInitialized(): boolean {
  return _initialized;
}

/**
 * Returns a flat map of { intentKey → handler } for every plugin.
 * Includes: plugin.name and every entry in plugin.intents[].
 * Merge this into the intentMap after loadPlugins() resolves.
 */
export function getPluginIntentMap(): Record<string, Handler> {
  const map: Record<string, Handler> = {};

  for (const plugin of _plugins) {
    // Primary key: plugin.name
    map[plugin.name] = plugin.handler;

    // Extra intent aliases
    for (const intent of plugin.intents ?? []) {
      map[intent] = plugin.handler;
    }
  }
  return map;
}

/**
 * Returns an array of { patterns, handler } route entries for every plugin
 * that declares at least one pattern.
 * These should be prepended to (or merged with) the ROUTES array so plugin
 * patterns are checked before the built-in ones.
 */
export function getPluginRoutes(): Array<{
  patterns: RegExp[];
  handler: Handler;
}> {
  const routes: Array<{ patterns: RegExp[]; handler: Handler }> = [];

  for (const plugin of _plugins) {
    if (plugin.patterns && plugin.patterns.length > 0) {
      routes.push({ patterns: plugin.patterns, handler: plugin.handler });
    }
  }

  return routes;
}

/**
 * Returns all autocomplete command suggestions contributed by plugins.
 * Merge these into COMMANDS in commands.ts (or append at runtime).
 */
export function getPluginCommands(): Array<{
  command: string;
  description: string;
}> {
  return _plugins.flatMap((p) => p.commands ?? []);
}

/**
 * Look up a handler by intent name across the plugin registry.
 * Returns null if not found.
 */
export function findPluginHandler(intent: string): Handler | null {
  for (const plugin of _plugins) {
    if (plugin.name === intent) return plugin.handler;
    if (plugin.intents?.includes(intent)) return plugin.handler;
  }
  return null;
}

/**
 * Test all plugin patterns against an input string.
 * Returns the first matching handler, or null.
 */
export function matchPluginRoute(input: string): Handler | null {
  const lower = input.toLowerCase();
  for (const plugin of _plugins) {
    if (plugin.patterns?.some((p) => p.test(lower))) {
      return plugin.handler;
    }
  }
  return null;
}
