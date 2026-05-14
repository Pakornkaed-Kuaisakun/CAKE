// src/modules/memory/index.ts
import crypto from "crypto";

import type { AIProvider } from "../../providers/types.js";
import { VectorStore } from "./store.js";
import type { MemoryEntry, SearchResult } from "./types.js";

// ── One-time warning: emitted at most once per process ───────────────────────
let embedWarningEmitted = false;

/** Returns true (and marks as emitted) the first time no-embed is detected. */
export function consumeEmbedWarning(): boolean {
  if (embedWarningEmitted) return false;
  embedWarningEmitted = true;
  return true;
}

export class MemoryManager {
  private store: VectorStore;
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
    this.store = new VectorStore();
  }

  async remember(
    text: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    if (!this.provider.embed) {
      // Trigger the one-time flag — the CLI will pick it up separately.
      consumeEmbedWarning();
      return;
    }

    const embedding = await this.provider.embed(text);

    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      text,
      embedding,
      metadata: {
        source: "general",
        timestamp: Date.now(),
        ...metadata,
      },
    };

    await this.store.add(entry);
  }

  async retrieve(query: string, limit = 3): Promise<string[]> {
    if (!this.provider.embed) return [];

    const queryEmbedding = await this.provider.embed(query);
    const results = this.store.search(queryEmbedding, limit);

    return results.filter((r) => r.score > 0.7).map((r) => r.entry.text);
  }
}

export * from "./types.js";
