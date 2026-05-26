// src/modules/search/cache.ts
// Lightweight in-memory cache for search results and embeddings.

import fs from "fs/promises";
import path from "path";

type CacheEntry = {
  url: string;
  summary: string;
  sourceType?: string;
  embedding?: number[];
  metadata?: Record<string, any>;
  fetchedAt: string; // ISO
};

const cache = new Map<string, CacheEntry>();
let CACHE_TTL_DAYS = 7; // default expiration
let PERSIST_PATH = path.resolve(process.cwd(), ".cache", "search-cache.json");

function normalize(url: string) {
  try {
    return new URL(url).origin + new URL(url).pathname;
  } catch {
    return url;
  }
}

function isExpired(entry: CacheEntry) {
  try {
    const fetched = new Date(entry.fetchedAt).getTime();
    const ageMs = Date.now() - fetched;
    const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    return ageMs > ttlMs;
  } catch {
    return false;
  }
}

export function getCache(url: string): CacheEntry | undefined {
  const key = normalize(url);
  const e = cache.get(key);
  if (!e) return undefined;
  if (isExpired(e)) {
    cache.delete(key);
    return undefined;
  }
  return e;
}

export function setCache(entry: CacheEntry) {
  cache.set(normalize(entry.url), entry);
}

export function clearCache() {
  cache.clear();
}

export function allEntries() {
  return Array.from(cache.values());
}

export async function saveToDisk(filePath?: string) {
  const p = filePath ?? PERSIST_PATH;
  await fs.mkdir(path.dirname(p), { recursive: true });
  const data = JSON.stringify(allEntries());
  await fs.writeFile(p, data, "utf8");
}

export async function loadFromDisk(filePath?: string) {
  const p = filePath ?? PERSIST_PATH;
  try {
    const raw = await fs.readFile(p, "utf8");
    const arr: CacheEntry[] = JSON.parse(raw);
    for (const e of arr) {
      if (!isExpired(e)) cache.set(normalize(e.url), e);
    }
  } catch {
    // ignore missing or invalid cache
  }
}

export function setTtlDays(days: number) {
  CACHE_TTL_DAYS = days;
}

export function setPersistPath(p: string) {
  PERSIST_PATH = p;
}

export default { getCache, setCache, clearCache, allEntries, saveToDisk, loadFromDisk, setTtlDays, setPersistPath };
