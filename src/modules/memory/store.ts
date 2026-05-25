import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";
import type { MemoryEntry, SearchResult } from "./types.js";

export class VectorStore {
  private filePath: string;
  private entries: MemoryEntry[] = [];

  constructor(storageDir = path.join(CAKE_DIR, "memory")) {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.filePath = path.join(storageDir, "vectors.json");
    this.load();
  }


  private load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = fs.readFileSync(this.filePath, "utf-8");
        this.entries = JSON.parse(data);
      } catch (err) {
        console.error("Failed to load memory:", err);
        this.entries = [];
      }
    }
  }

  private save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
  }

  async add(entry: MemoryEntry) {
    this.entries.push(entry);
    this.save();
  }

  /** Return a shallow copy of all entries (for maintenance / reflection) */
  listEntries(): MemoryEntry[] {
    return [...this.entries];
  }

  /** Update an existing entry by id with partial data and persist */
  updateEntry(id: string, data: Partial<MemoryEntry>) {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.entries[idx] = { ...this.entries[idx], ...data, metadata: { ...this.entries[idx].metadata, ...(data.metadata ?? {}) } } as MemoryEntry;
    this.save();
    return true;
  }

  search(queryEmbedding: number[], limit = 5): SearchResult[] {
    const results = this.entries.map((entry) => ({
      entry,
      score: this.cosineSimilarity(queryEmbedding, entry.embedding),
    }));

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  clear() {
    this.entries = [];
    this.save();
  }
}
