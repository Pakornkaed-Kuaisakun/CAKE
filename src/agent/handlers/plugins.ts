// src/agent/handlers/plugins.ts
//
// Handler for the "plugins" intent + the /plugins slash command helper.

import type { AIProvider, ChatResult } from "../../providers/types.js";
import { getPlugins, isInitialized, PLUGINS_DIR } from "../plugins/index.js";
import { text } from "../utils/text.js";

export async function handlePlugins(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  if (!isInitialized()) {
    return text("[PLUGINS] Plugin system not yet initialized.");
  }

  const plugins = getPlugins();

  if (plugins.length === 0) {
    return text(
      [
        `[PLUGINS] No plugins loaded.`,
        ``,
        `To add a plugin, drop a .js file into:`,
        `  ${PLUGINS_DIR}`,
        ``,
        `Each plugin must export a default object with:`,
        `  { name, description, handler, patterns|intents }`,
        ``,
        `Example (~/.cake/plugins/hello.js):`,
        `  export default {`,
        `    name: "hello",`,
        `    description: "Say hello back",`,
        `    patterns: [/^hello\\b/i],`,
        `    handler: async (_p, input) => ({ text: "👋 Hello! " + input }),`,
        `  };`,
      ].join("\n"),
    );
  }

  const lines = plugins.map((p, i) => {
    const intentKeys = [p.name, ...(p.intents ?? [])].join(", ");
    const patterns = p.patterns?.map((rx) => rx.toString()).join(", ") ?? "—";
    return [
      `${i + 1}. ${p.name}`,
      `   ${p.description}`,
      `   Intents : ${intentKeys}`,
      `   Patterns: ${patterns}`,
      `   File    : ${p.filePath}`,
    ].join("\n");
  });

  return text(
    [
      `[PLUGINS] ${plugins.length} plugin${plugins.length !== 1 ? "s" : ""} loaded`,
      `Plugin directory: ${PLUGINS_DIR}`,
      ``,
      ...lines,
    ].join("\n"),
  );
}
