// src/modules/hallucination/tracker.ts
//
// Persists hallucination events and computes rolling stats.
// Stored at ~/.cake/hallucination-log.json (capped at 500 events, ~500KB).
//
// Stats are recomputed lazily and cached with a 60s TTL so /hallucination
// commands respond instantly without re-scanning the full log.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CAKE_DIR } from "../../config/constants.js";
import type {
  HallucinationEvent,
  HallucinationStats,
  HallucinationRisk,
} from "./types.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

const LOG_FILE = path.join(CAKE_DIR, "hallucination-log.json");
const MAX_EVENTS = 500;

// ── I/O ───────────────────────────────────────────────────────────────────────

interface LogFile {
  events: HallucinationEvent[];
  lastUpdated: string;
}

function loadLog(): LogFile {
  try {
    if (!fs.existsSync(LOG_FILE))
      return { events: [], lastUpdated: new Date().toISOString() };
    const raw = fs.readFileSync(LOG_FILE, "utf-8");
    return JSON.parse(raw) as LogFile;
  } catch {
    return { events: [], lastUpdated: new Date().toISOString() };
  }
}

function saveLog(log: LogFile): void {
  if (!fs.existsSync(CAKE_DIR)) fs.mkdirSync(CAKE_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), "utf-8");
}

// ── Stat cache ────────────────────────────────────────────────────────────────

let _cachedStats: HallucinationStats | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 60_000;

function invalidateCache(): void {
  _cachedStats = null;
  _cacheExpiry = 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a hallucination check event to the persistent log.
 * Non-blocking: write errors are silently swallowed.
 */
export function trackEvent(
  input: string,
  response: string,
  score: import("./types.js").HallucinationScore,
  finalResponse: string,
  hedged: boolean,
): void {
  try {
    const log = loadLog();
    const event: HallucinationEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      input: input.slice(0, 200),
      response: response.slice(0, 500),
      score,
      hedged,
      finalResponse: finalResponse.slice(0, 500),
    };

    log.events.push(event);

    // Keep at most MAX_EVENTS (drop oldest)
    if (log.events.length > MAX_EVENTS) {
      log.events = log.events.slice(-MAX_EVENTS);
    }

    log.lastUpdated = new Date().toISOString();
    saveLog(log);
    invalidateCache();
  } catch {
    // Tracking is always non-fatal
  }
}

/**
 * Compute and return rolling stats across all logged events.
 * Result is cached for 60s.
 */
export function getStats(): HallucinationStats {
  const now = Date.now();
  if (_cachedStats && now < _cacheExpiry) return _cachedStats;

  const log = loadLog();
  const events = log.events;

  if (events.length === 0) {
    const empty: HallucinationStats = {
      totalChecked: 0,
      totalFlagged: 0,
      totalHedged: 0,
      avgScore: 0,
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
      topPatterns: [],
      lastUpdated: log.lastUpdated,
    };
    _cachedStats = empty;
    _cacheExpiry = now + CACHE_TTL_MS;
    return empty;
  }

  const flagged = events.filter((e) => e.score.risk !== "low").length;
  const hedged = events.filter((e) => e.hedged).length;
  const avgScore =
    events.reduce((s, e) => s + e.score.overall, 0) / events.length;

  const riskDist: Record<HallucinationRisk, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const e of events) riskDist[e.score.risk]++;

  // Pattern frequency
  const patternCounts: Record<string, number> = {};
  for (const e of events) {
    for (const p of e.score.fabricationSignals) {
      patternCounts[p] = (patternCounts[p] ?? 0) + 1;
    }
  }
  const topPatterns = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pattern, count]) => ({ pattern, count }));

  _cachedStats = {
    totalChecked: events.length,
    totalFlagged: flagged,
    totalHedged: hedged,
    avgScore: Math.round(avgScore * 1000) / 1000,
    riskDistribution: riskDist,
    topPatterns,
    lastUpdated: log.lastUpdated,
  };
  _cacheExpiry = now + CACHE_TTL_MS;
  return _cachedStats;
}

/**
 * Return the N most recent logged events.
 */
export function getRecentEvents(limit = 10): HallucinationEvent[] {
  const log = loadLog();
  return log.events.slice(-limit).reverse();
}

/**
 * Clear the log (for testing / user request).
 */
export function clearLog(): number {
  const log = loadLog();
  const count = log.events.length;
  saveLog({ events: [], lastUpdated: new Date().toISOString() });
  invalidateCache();
  return count;
}

/**
 * Return the file path for display in /hallucination info.
 */
export function logFilePath(): string {
  return LOG_FILE;
}
