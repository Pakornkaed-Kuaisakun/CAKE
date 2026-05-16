// Discovers *.js / *.mjs / *.cjs files in ~/.cake/plugins/ at startup,
// dynamically imports each one, validates the default export,
// and returns the list of valid LoadedPlugin instances.
//
// Errors in individual plugins are isolated — a bad plugin never crashes CAKE.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { CAKE_DIR } from "../../config/constants.js";
import type { Plugin, LoadedPlugin } from "./types.js";

export const PLUGINS_DIR = path.join(CAKE_DIR, "plugins");

const SUPPORTED_EXTS = new Set([".js", ".mjs", ".cjs"]);

/** Returns true if the object looks like a valid Plugin */
function isValidPlugin(obj: unknown): obj is Plugin {
  if (typeof obj !== "object" || obj === null) return false;
  const p = obj as Record<string, unknown>;
  if (typeof p.name !== "string" || !p.name.trim()) return false;
  if (typeof p.description !== "string") return false;
  if (typeof p.handler !== "function") return false;
  const hasPatterns = Array.isArray(p.patterns) && p.patterns.length > 0;
  const hasIntents = Array.isArray(p.intents) && p.intents.length > 0;
  if (!hasPatterns && !hasIntents) return false;
  return true;
}

/**
 * Loads all plugins from PLUGINS_DIR.
 */
export async function loadAllPlugins(
  onLog?: (msg: string) => void,
): Promise<LoadedPlugin[]> {
  // Ensure the directory exists so users can drop plugins there
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  } catch (err: any) {
    const msg = `[plugins] Could not read plugins directory: ${err.message}`;
    if (onLog) onLog(msg);
    else console.warn(msg);
    return [];
  }

  const pluginFiles = entries
    .filter((e) => e.isFile() && SUPPORTED_EXTS.has(path.extname(e.name)))
    .map((e) => path.join(PLUGINS_DIR, e.name));

  const loaded: LoadedPlugin[] = [];

  for (const filePath of pluginFiles) {
    try {
      // Dynamic import via file:// URL (required for ESM in Node)
      const fileUrl = pathToFileURL(filePath).href;
      const mod = await import(fileUrl);

      // Support both `export default` and `module.exports = `
      const exported = mod.default ?? mod;

      if (!isValidPlugin(exported)) {
        const msg =
          `[plugins] Skipping "${path.basename(filePath)}" — invalid plugin shape.\n` +
          `  Required: { name, description, handler, patterns|intents }`;
        if (onLog) onLog(msg);
        else console.warn(msg);
        continue;
      }

      loaded.push({ ...exported, filePath });
      // const msg = `[plugins] Loaded: ${exported.name} (${path.basename(filePath)})`;
      // if (onLog) onLog(msg);
      // else console.log(msg);
    } catch (err: any) {
      const msg = `[plugins] Failed to load "${path.basename(filePath)}": ${err.message}`;
      if (onLog) onLog(msg);
      else console.warn(msg);
    }
  }
  return loaded;
}
