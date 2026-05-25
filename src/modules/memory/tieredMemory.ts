// src/modules/memory/tieredMemory.ts
import crypto from "crypto";
import { VectorStore } from "./store.js";
import type { AIProvider, Message } from "../../providers/types.js";

const DEFAULT_RETRIEVE_LIMIT = 3;
const MAX_RETRIEVED_MEMORIES = 2;
const MIN_MEMORY_SCORE = 0.35;
const MEMORY_HALF_LIFE_DAYS = 14;

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

  constructor(provider: AIProvider, storageDir?: string) {
    this.provider = provider;
    this.store = new VectorStore(storageDir);
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

  async retrieve(query: string, limit = 3): Promise<string[]> {
    if (!this.provider.embed) return [];

    const queryEmbedding = await this.provider.embed(query);
    const results = this.store.search(queryEmbedding, limit * 2);

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

  /**
   * Retrieve memories but restrict to recent conversation-source entries
   * (approximate "session memory").
   */
  async retrieveSession(
    query: string,
    hours = 24,
    limit = 3,
  ): Promise<string[]> {
    if (!this.provider.embed) return [];

    const queryEmbedding = await this.provider.embed(query);
    const results = this.store.search(queryEmbedding, limit * 3);

    const now = Date.now();
    const cutoff = now - hours * 3_600_000;

    const filtered = results
      .filter((r) => (r.entry.metadata.source ?? "") === "conversation")
      .filter((r) => (r.entry.metadata.timestamp ?? 0) >= cutoff)
      .map((r) => ({ entry: r.entry, score: r.score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(limit, results.length));

    return filtered.map((r) => r.entry.text.slice(0, 200));
  }

  /**
   * Retrieve raw memory entries (with ids and metadata) for a query.
   * Useful for linking decisions to specific memory entries.
   */
  async retrieveEntries(
    query: string,
    limit = 5,
  ): Promise<import("./types.js").MemoryEntry[]> {
    if (!this.provider.embed) return [];

    const queryEmbedding = await this.provider.embed(query);
    const results = this.store.search(queryEmbedding, limit);

    // Return MemoryEntry objects sorted by score
    return results.map((r) => r.entry);
  }

  /**
   * Self-reflection: iterate over stored summaries and ask the provider to
   * refine/expand them. Updates entry text and embedding in-place.
   * Returns number of entries updated.
   */
  async reflectAndUpdate(model?: string, limit = 50): Promise<number> {
    if (!this.provider.embed || !this.provider.chat) return 0;

    const entries = (this.store as any).listEntries() as import("./types.js").MemoryEntry[];
    const toProcess = entries.slice(0, limit);
    let updated = 0;

    for (const e of toProcess) {
      try {
        const system = `You are an assistant that refines short memory summaries for long-term storage. Improve the summary to be factual, concise (<=200 chars), preserve important decisions/actions, and add a one-line tag if it contains an action or decision.`;
        const user = `Original summary: ${e.text}\n\nFull content (may be truncated): ${e.metadata.fullContent ?? ''}\n\nReturn ONLY the improved summary. If you detect actions or decisions, prefix the summary with [ACTION] or [DECISION].`;

        const messages: Message[] = [
          { role: "system", content: system },
          { role: "user", content: user },
        ];

        const resp = await this.provider.chat(messages, { model: model });
        const newSummary = resp?.text?.trim();
        if (!newSummary) continue;

        const newEmbedding = await this.provider.embed(newSummary);

        (this.store as any).updateEntry(e.id, {
          text: newSummary,
          embedding: newEmbedding,
          metadata: { refinedAt: Date.now(), refinedModel: model ?? "auto" },
        });

        updated++;
      } catch (err) {
        // non-fatal — continue
      }
    }

    return updated;
  }

  private async compressMemoToSummary(
    text: string,
    source: string,
  ): Promise<string> {
    if (text.length < 120) return text;

    // Use heuristic compression (no LLM) for speed
    const firstLine =
      text.split("\n").find((l) => l.trim().length > 20) ?? text.slice(0, 120);
    const wordCount = text.split(/\s+/).length;
    const base = `[${source}] ${firstLine.slice(0, 110)}`;
    return `${base}${wordCount > 35 ? ` (+${wordCount - 35} words)` : ""}`;
  }

  private estimateImportance(
    text: string,
    metadata: Record<string, any>,
  ): number {
    if (/^\[(ACTION|DECISION)\]/i.test(text)) return 0.95;
    if (metadata.source === "tool") return 0.3;
    if (metadata.source === "conversation") return 0.7;
    if (metadata.source === "file-index") return 0.9;
    return 0.55;
  }
}
