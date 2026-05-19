// src/modules/memory/tieredMemory.ts
import crypto from "crypto";
import { VectorStore } from "./store.js";
import type { AIProvider } from "../../providers/types.js";

/** Working memory: current session's key facts */
export class WorkingMemory {
  private facts: Map<string, string> = new Map();

  set(key: string, value: string): void {
    this.facts.set(key, value.slice(0, 200));
  }

  getAll(): string[] {
    return [...this.facts.values()];
  }

  clear(): void {
    this.facts.clear();
  }
}

/** Compressed retrieval — returns summaries, not full content */
export class TieredMemoryManager {
  private store: VectorStore;
  private working: WorkingMemory;
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
    this.store = new VectorStore();
    this.working = new WorkingMemory();
  }

  async remember(
    text: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    if (!this.provider.embed) return;

    // Compress before storing
    const summary = await this.compressMemoToSummary(
      text,
      metadata.source ?? "general",
    );
    const embedding = await this.provider.embed(summary); // embed the summary, not full text

    await this.store.add({
      id: crypto.randomUUID(),
      text: summary, // store summary as primary text
      embedding,
      metadata: {
        fullContent: text.slice(0, 5000), // keep full content in metadata
        source: metadata.source ?? "general",
        timestamp: Date.now(),
        importance: this.estimateImportance(text, metadata),
        ...metadata,
      },
    });
  }

  async retrieve(query: string, limit = 5): Promise<string[]> {
    if (!this.provider.embed) return [];

    const queryEmbedding = await this.provider.embed(query);
    const results = this.store.search(queryEmbedding, limit);

    // Apply temporal decay: boost recent memories
    const now = Date.now();
    const scored = results
      .map((r) => {
        const ageDays =
          (now - (r.entry.metadata.timestamp ?? now)) / 86_400_000;
        const decayFactor = Math.exp(-ageDays / 30); // 30-day half-life
        const importance = r.entry.metadata.importance ?? 0.5;
        return {
          entry: r.entry,
          finalScore: r.score * 0.6 + decayFactor * 0.2 + importance * 0.2,
        };
      })
      .filter((r) => r.finalScore > 0.4)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 3); // never more than 3

    // Return SUMMARIES not full content, capped at 200 chars for safety
    return scored.map((r) => r.entry.text.slice(0, 200)); // text IS the summary now
  }

  private async compressMemoToSummary(
    text: string,
    source: string,
  ): Promise<string> {
    if (text.length < 200) return text;

    // Use heuristic compression (no LLM) for speed
    const firstLine =
      text.split("\n").find((l) => l.trim().length > 20) ?? text.slice(0, 100);
    const wordCount = text.split(/\s+/).length;

    return `[${source}] ${firstLine.slice(0, 150)}${wordCount > 50 ? ` (+${wordCount - 50} words)` : ""}`;
  }

  private estimateImportance(
    text: string,
    metadata: Record<string, any>,
  ): number {
    // Tool results are less important than conversation
    if (metadata.source === "tool") return 0.3;
    if (metadata.source === "conversation") return 0.7;
    if (metadata.source === "file-index") return 0.9;
    return 0.5;
  }
}
