import type { AIProvider, ChatResult } from "../../providers/types.js";

export type PluginHandler = (
  provider: AIProvider,
  input: string,
  model?: string,
) => Promise<ChatResult>;

/**
 * The shape every plugin file must export as its default export.
 *
 * Minimal example (~/.cake/plugins/hello.js):
 * ─────────────────────────────────────────────
 * export default {
 *   name: "hello",
 *   description: "Say hello",
 *   patterns: [/^hello\b/i],
 *   intents: ["hello"],
 *   handler: async (_provider, input) => ({
 *     text: `👋 Hello! You said: ${input}`,
 *   }),
 * };
 */

export interface Plugin {
  /** Unique name — used as the intentMap key and in /plugins list */
  name: string;

  /** Short description shown in /help and /plugins */
  description: string;

  /**
   * Regex patterns for the router (matched against lowercased input).
   * At least one pattern OR one intent is required.
   */
  patterns?: RegExp[];

  /**
   * Additional intent-map keys this plugin handles
   * (e.g. ["hello", "hi_plugin"] — all route to the same handler).
   */
  intents?: string[];

  /** The function that handles matching input */
  handler: PluginHandler;

  /**
   * Optional: autocomplete suggestions to inject into commands.ts.
   * Each entry appears in the CommandPopup.
   */
  commands?: Array<{ command: string; description: string }>;
}

export interface LoadedPlugin extends Plugin {
  filePath: string;
}
