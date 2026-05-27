// Shared display helpers used by the finance handler and report generator.

/** Format a number as currency. */
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

/** Format a large number with suffix, optionally with currency symbol.
 *  e.g. 1_500_000_000 → "$1.50B"  or  85_000_000 → "85.0M" */

export function formatLargeNumber(value: number, currency?: string): string {
  if (!value && value !== 0) return "N/A";
  const prefix = currency ? (currency === "USD" ? "$" : currency + " ") : "";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${prefix}${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${prefix}${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${prefix}${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${prefix}${(value / 1e3).toFixed(1)}K`;
  return `${prefix}${value.toFixed(0)}`;
}

/** Format a percentage value, e.g. 12.345 → "+12.35%" */
export function formatPct(value: number, showSign = true): string {
  if (value === null || value === undefined || isNaN(value)) return "N/A";
  const sign = showSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
