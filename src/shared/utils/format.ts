// ── File sizes ─────────────────────────────────────────────────────────────────

/**
 * Format a byte count as a human-readable file size string.
 *
 * @example
 *   formatSize(0)         → "0 B"
 *   formatSize(1536)      → "1.5 KB"
 *   formatSize(2097152)   → "2.0 MB"
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Currency / large numbers ───────────────────────────────────────────────────

/**
 * Format a number as a currency string.
 *
 * @example
 *   formatCurrency(1234.56)        → "$1,234.56"
 *   formatCurrency(42, "EUR")      → "€42.00"
 */
export function formatCurrency(value: number, currency = "USD"): string {
  if (!value && value !== 0) return "N/A";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

/**
 * Format a large number with a K/M/B/T suffix, optionally prefixed by currency.
 *
 * @example
 *   formatLargeNumber(1_500_000_000, "USD") → "$1.50B"
 *   formatLargeNumber(85_000)               → "85.0K"
 */
export function formatLargeNumber(value: number, currency?: string): string {
  if (!value && value !== 0) return "N/A";
  const prefix = currency ? (currency === "USD" ? "$" : `${currency} `) : "";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${prefix}${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${prefix}${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${prefix}${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${prefix}${(value / 1e3).toFixed(1)}K`;
  return `${prefix}${value.toFixed(0)}`;
}

/**
 * Format a percentage value.
 *
 * @example
 *   formatPct(12.345)         → "+12.35%"
 *   formatPct(-3.5, false)    → "-3.50%"
 */
export function formatPct(value: number, showSign = true): string {
  if (value === null || value === undefined || isNaN(value)) return "N/A";
  const sign = showSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Format a USD cost for display in token usage footers.
 *
 * @example
 *   formatCost(0.00005)  → "<$0.001"
 *   formatCost(0.0123)   → "$0.0123"
 */
export function formatCost(usd: number): string {
  if (usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(4)}`;
}

// ── Progress bars ──────────────────────────────────────────────────────────────

/**
 * Render a simple ASCII progress bar.
 *
 * @example
 *   asciiBar(3, 10, 10)  → "███░░░░░░░"
 */
export function asciiBar(value: number, max: number, width = 20): string {
  const filled = Math.round((Math.min(value, max) / Math.max(max, 1)) * width);
  return (
    "█".repeat(Math.max(0, filled)) + "░".repeat(width - Math.max(0, filled))
  );
}

export function sentimentBar(score: number): string {
  // score: -1 (bearish) to +1 (bullish)
  const normalized = (score + 1) / 2; // 0..1
  const pos = Math.round(normalized * 10);
  const neg = 10 - pos;
  return "🔴".repeat(neg) + "🟢".repeat(pos);
}

export function changeArrow(change: number): string {
  if (change > 0) return `▲ +${formatPct(change)}`;
  if (change < 0) return `▼ ${formatPct(change)}`;
  return `● 0.00%`;
}

export function formatScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}
