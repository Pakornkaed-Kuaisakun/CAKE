// src/modules/memory/index.ts
import { TieredMemoryManager } from "./tieredMemory.js";

// ── Embed-quality warning ─────────────────────────────────────────────────────
//
// Previously this warned whenever provider.embed was falsy (missing method).
// Now all providers implement embed(), so the check is:
//   - Emit a softer note only when Claude is running in hash-fallback mode
//     (no VOYAGE_API_KEY), so users know semantic quality is reduced.
//   - Never warn for OpenAI/Gemini/Ollama/OpenRouter — all have native embeds.
//   - Emit at most once per process.

let embedWarningEmitted = false;

/** Returns true (and marks as emitted) the first time no-embed is detected. */
export function consumeEmbedWarning(): boolean {
  if (embedWarningEmitted) return false;
  embedWarningEmitted = true;
  return true;
}

/**
 * Check if the provider will use a low-quality hash fallback for embeddings.
 * Returns a warning message, or null if embeddings are high-quality.
 *
 * Called once at startup so the UI can inform the user.
 */
export function getEmbedQualityWarning(providerName: string): string | null {
  if (providerName !== "claude") return null; // All other providers have native embeds
  if (process.env.VOYAGE_API_KEY) return null; // Voyage key present → full quality
  if (process.env.CAKE_EMBED === "hash") {
    return (
      "⚡ Using hash-based embeddings (CAKE_EMBED=hash).\n" +
      "   Memory features work but semantic search quality is reduced.\n" +
      "   Set VOYAGE_API_KEY for full-quality Voyage AI embeddings."
    );
  }
  // No key, no override — hash fallback is active
  return (
    "⚡ Using hash-based embeddings (no VOYAGE_API_KEY).\n" +
    "   Memory and search features work, but semantic recall is reduced.\n" +
    "   Add VOYAGE_API_KEY to .env for full-quality Voyage AI embeddings (free tier available)."
  );
}

export class MemoryManager extends TieredMemoryManager {
  constructor(
    provider: import("../../providers/types.js").AIProvider,
    storageDir?: string,
  ) {
    super(provider, storageDir);
  }

  override async remember(
    text: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    // All providers now have embed() — no need to gate on its presence
    await super.remember(text, metadata);
  }
}

export * from "./types.js";
export { TieredMemoryManager, WorkingMemory } from "./tieredMemory.js";
