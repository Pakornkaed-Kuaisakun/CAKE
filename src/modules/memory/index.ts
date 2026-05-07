import crypto from "crypto";

import type { AIProvider } from "../../providers/types.js";
import { VectorStore } from "./store.js";
import type { MemoryEntry, SearchResult } from "./types.js";

export class MemoryManager {
  private store: VectorStore;
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
    this.store = new VectorStore();
  }

  /**
   * Add a new piece of information to the memory.
   */
  async remember(text: string, metadata: Record<string, any> = {}): Promise<void> {
    if (!this.provider.embed) {
      console.warn("Provider does not support embeddings. Memory skipped.");
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

  /**
   * Retrieve relevant past context based on a query.
   */
  async retrieve(query: string, limit = 3): Promise<string[]> {
    if (!this.provider.embed) return [];

    const queryEmbedding = await this.provider.embed(query);
    const results = this.store.search(queryEmbedding, limit);

    // Only return reasonably relevant matches
    return results
      .filter((r) => r.score > 0.7) 
      .map((r) => r.entry.text);
  }
}

export * from "./types.js";
