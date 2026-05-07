import type { AgentResponse } from "./index.js";

interface CacheEntry {
  value: AgentResponse;
  expiresAt: number; // Unix timestamp in ms
}

/**
 * Simple in-memory LRU cache with TTL support.
 */

export class ResponseCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    // Refresh recency for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: AgentResponse): void {
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
      else break;
    }
  }
}
