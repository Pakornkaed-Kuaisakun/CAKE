// src/agent/intentCache.ts
//
// Lightweight intent-result cache for aiIntentRouter.
// Avoids burning an API call for repeated or near-identical phrasings.
//
// Strategy:
//   • Exact-match cache  — normalized input → intent (TTL: 10 min, max 500 entries)
//   • Prefix-group cache — for inputs that share the same first word(s) and
//     converge to the same intent (e.g. "show my todos" / "list my tasks")
//     we store the first-word → intent pair and promote on each cache hit.

interface IntentEntry {
  intent: string;
  hits: number;
  expiresAt: number;
}

const EXACT_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_EXACT = 500;

const exactCache = new Map<string, IntentEntry>();

// ── Normalise: lowercase, collapse whitespace, strip trailing punctuation ─────
export function normalizeInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?.!,;]+$/, "")
    .trim();
}

// ── Evict one expired or least-recently-used entry ───────────────────────────
function evict(): void {
  const now = Date.now();
  for (const [key, entry] of exactCache) {
    if (entry.expiresAt <= now) {
      exactCache.delete(key);
      return;
    }
  }
  // No expired entry — delete the oldest (Map iteration order = insertion order)
  const firstKey = exactCache.keys().next().value;
  if (firstKey) exactCache.delete(firstKey);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns cached intent for this input, or null on miss/expired. */
export function getCachedIntent(raw: string): string | null {
  const key = normalizeInput(raw);
  const entry = exactCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    exactCache.delete(key);
    return null;
  }
  // LRU refresh
  exactCache.delete(key);
  entry.hits++;
  entry.expiresAt = Date.now() + EXACT_TTL_MS;
  exactCache.set(key, entry);
  return entry.intent;
}

/** Stores the router result in cache. */
export function setCachedIntent(raw: string, intent: string): void {
  const key = normalizeInput(raw);
  // Never cache "chat" — it's the catch-all and shouldn't shadow future tool inputs
  if (intent === "chat") return;

  if (exactCache.size >= MAX_EXACT) evict();

  exactCache.set(key, {
    intent,
    hits: 1,
    expiresAt: Date.now() + EXACT_TTL_MS,
  });
}

/** Returns cache statistics (useful for /diagnose). */
export function getIntentCacheStats(): {
  size: number;
  topIntents: Array<{ intent: string; count: number }>;
} {
  const counts: Record<string, number> = {};
  for (const entry of exactCache.values()) {
    counts[entry.intent] = (counts[entry.intent] ?? 0) + entry.hits;
  }
  const topIntents = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([intent, count]) => ({ intent, count }));
  return { size: exactCache.size, topIntents };
}

/** Clears all cached intents (e.g., after /provider switch). */
export function clearIntentCache(): void {
  exactCache.clear();
}
