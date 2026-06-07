// ── Duration ───────────────────────────────────────────────────────────────────

/**
 * Format a millisecond duration as a human-readable string.
 *
 * @example
 *   fmtMs(500)    → "500ms"
 *   fmtMs(1500)   → "1.5s"
 *   fmtMs(90000)  → "1m 30s"
 */

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Alias used in CLI streaming display. */
export const formatMs = fmtMs;

// ── Relative age ───────────────────────────────────────────────────────────────

/**
 * Return a human-readable "time ago" string from a Unix timestamp.
 *
 * @example
 *   fmtAge(Date.now() - 5000)   → "5s ago"
 *   fmtAge(Date.now() - 90000)  → "1m ago"
 */
export function fmtAge(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

// ── Absolute date ──────────────────────────────────────────────────────────────

/**
 * Format an optional Unix timestamp as a locale string, or "—" if absent.
 */
export function fmtDate(ts?: string): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

/**
 * Format an ISO string or Unix timestamp; returns the string as-is on error.
 */
export function fmtIso(ts: number | string): string {
  try {
    return new Date(typeof ts === "number" ? ts : ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

// ── Sleep ──────────────────────────────────────────────────────────────────────

/** Promise-based delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
