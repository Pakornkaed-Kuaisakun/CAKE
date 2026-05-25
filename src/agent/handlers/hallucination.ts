// src/agent/handlers/hallucination.ts
//
// Handler for the /hallucination slash command.
//
// Sub-commands:
//   /hallucination              — show stats overview
//   /hallucination stats        — alias for above
//   /hallucination recent [n]   — show last N flagged events (default 5)
//   /hallucination clear        — clear the log
//   /hallucination on           — enable post-processing (default)
//   /hallucination off          — disable post-processing this session
//   /hallucination threshold <n>— set the flagging threshold (0.0–1.0)
//   /hallucination info         — show config and file paths

import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";
import {
  getStats,
  getRecentEvents,
  clearLog,
  logFilePath,
} from "../../modules/hallucination/tracker.js";
import type { HallucinationRisk } from "../../modules/hallucination/types.js";

// ── Session config (not persisted — resets on restart) ────────────────────────

export interface HallucinationConfig {
  enabled: boolean;
  threshold: number; // 0.0–1.0; responses above this get hedging
  trackAll: boolean; // track low-risk responses too (for stats)
  verbose: boolean; // annotate individual claims
}

export const hallucinationConfig: HallucinationConfig = {
  enabled: true,
  threshold: 0.4,
  trackAll: false,
  verbose: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function riskIcon(risk: HallucinationRisk): string {
  switch (risk) {
    case "low":
      return "✅";
    case "medium":
      return "⚠️";
    case "high":
      return "🔶";
    case "critical":
      return "🚨";
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function fmtScore(score: number): string {
  return (score * 100).toFixed(1) + "%";
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function handleHallucinationCommand(
  _provider: AIProvider,
  args: string[],
  _model?: string,
): Promise<ChatResult> {
  const sub = args[0]?.toLowerCase() ?? "stats";

  // ── /hallucination on ─────────────────────────────────────────────────────
  if (sub === "on") {
    hallucinationConfig.enabled = true;
    return text(
      "✅ Hallucination detection enabled. Risky responses will be hedged.",
    );
  }

  // ── /hallucination off ────────────────────────────────────────────────────
  if (sub === "off") {
    hallucinationConfig.enabled = false;
    return text(
      "⏸️  Hallucination detection disabled for this session.\n   Run /hallucination on to re-enable.",
    );
  }

  // ── /hallucination verbose ────────────────────────────────────────────────
  if (sub === "verbose") {
    hallucinationConfig.verbose = !hallucinationConfig.verbose;
    return text(
      hallucinationConfig.verbose
        ? "🔍 Verbose mode ON — individual suspect claims will be annotated with ⚠️"
        : "🔍 Verbose mode OFF",
    );
  }

  // ── /hallucination threshold <n> ─────────────────────────────────────────
  if (sub === "threshold") {
    const raw = parseFloat(args[1] ?? "");
    if (isNaN(raw) || raw < 0 || raw > 1) {
      return text(
        `Current threshold: ${hallucinationConfig.threshold}\n` +
          `Usage: /hallucination threshold <0.0–1.0>\n` +
          `  0.0 = flag everything\n` +
          `  0.4 = default (recommended)\n` +
          `  0.7 = only flag very risky responses\n` +
          `  1.0 = disable flagging`,
      );
    }
    hallucinationConfig.threshold = raw;
    return text(`✅ Threshold set to ${raw} (${fmtScore(raw)})`);
  }

  // ── /hallucination clear ──────────────────────────────────────────────────
  if (sub === "clear") {
    const count = clearLog();
    return text(
      `🗑️  Cleared ${count} event${count !== 1 ? "s" : ""} from the hallucination log.`,
    );
  }

  // ── /hallucination recent [n] ─────────────────────────────────────────────
  if (sub === "recent") {
    const limit = Math.min(20, Math.max(1, parseInt(args[1] ?? "5", 10) || 5));
    const events = getRecentEvents(limit);

    if (events.length === 0) {
      return text(
        "[HALLUCINATION] No events logged yet.\nStart chatting and events will be recorded automatically.",
      );
    }

    const rows = events.map((e, i) => {
      const time = new Date(e.timestamp).toLocaleString();
      const icon = riskIcon(e.score.risk);
      const hedgeNote = e.hedged ? " [hedged]" : "";
      const signals = e.score.fabricationSignals.slice(0, 3).join(", ");
      return [
        `${i + 1}. ${icon} ${e.score.risk.toUpperCase()} (${fmtScore(e.score.overall)}) — ${time}${hedgeNote}`,
        `   Input: "${e.input.slice(0, 70)}${e.input.length > 70 ? "…" : ""}"`,
        signals ? `   Signals: ${signals}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    return text(
      `[HALLUCINATION] Last ${events.length} event${events.length !== 1 ? "s" : ""}:\n` +
        "─".repeat(60) +
        "\n" +
        rows.join("\n\n"),
    );
  }

  // ── /hallucination info ───────────────────────────────────────────────────
  if (sub === "info") {
    return text(
      [
        "[HALLUCINATION PREVENTION] Configuration",
        "─".repeat(50),
        `  Status    : ${hallucinationConfig.enabled ? "✅ Enabled" : "⏸️  Disabled"}`,
        `  Threshold : ${hallucinationConfig.threshold} (${fmtScore(hallucinationConfig.threshold)})`,
        `  Verbose   : ${hallucinationConfig.verbose ? "On" : "Off"}`,
        `  Log file  : ${logFilePath()}`,
        "",
        "Risk levels:",
        "  ✅ low      → no action",
        "  ⚠️  medium   → prepend uncertainty notice",
        "  🔶 high     → strong caution notice + footnotes",
        "  🚨 critical → urgent warning + claim annotations",
        "",
        "Commands:",
        "  /hallucination             — show stats",
        "  /hallucination on|off      — toggle",
        "  /hallucination threshold N — set threshold (0.0–1.0)",
        "  /hallucination verbose     — toggle claim annotation",
        "  /hallucination recent [N]  — show last N events",
        "  /hallucination clear       — clear log",
      ].join("\n"),
    );
  }

  // ── /hallucination stats (default) ────────────────────────────────────────
  const stats = getStats();

  if (stats.totalChecked === 0) {
    return text(
      [
        "[HALLUCINATION PREVENTION] No data yet",
        "",
        `Status    : ${hallucinationConfig.enabled ? "✅ Enabled" : "⏸️  Disabled"}`,
        `Threshold : ${hallucinationConfig.threshold}`,
        `Log file  : ${logFilePath()}`,
        "",
        "Start chatting and events will be recorded automatically.",
        "Run /hallucination info for configuration help.",
      ].join("\n"),
    );
  }

  const flagRate = pct(stats.totalFlagged, stats.totalChecked);
  const hedgeRate = pct(stats.totalHedged, stats.totalChecked);

  const dist = stats.riskDistribution;
  const distBar = [
    dist.low > 0 ? `✅ low: ${dist.low}` : "",
    dist.medium > 0 ? `⚠️  med: ${dist.medium}` : "",
    dist.high > 0 ? `🔶 high: ${dist.high}` : "",
    dist.critical > 0 ? `🚨 crit: ${dist.critical}` : "",
  ]
    .filter(Boolean)
    .join("  ");

  const patterns =
    stats.topPatterns.length > 0
      ? stats.topPatterns
          .slice(0, 5)
          .map((p) => `  • ${p.pattern} (${p.count}×)`)
          .join("\n")
      : "  (none detected)";

  return text(
    [
      "[HALLUCINATION PREVENTION] Stats",
      "─".repeat(50),
      `  Checked   : ${stats.totalChecked} responses`,
      `  Flagged   : ${stats.totalFlagged} (${flagRate})`,
      `  Hedged    : ${stats.totalHedged} (${hedgeRate})`,
      `  Avg score : ${fmtScore(stats.avgScore)}`,
      `  Status    : ${hallucinationConfig.enabled ? "✅ Enabled" : "⏸️  Disabled"}`,
      `  Threshold : ${hallucinationConfig.threshold}`,
      "",
      "Risk distribution:",
      `  ${distBar}`,
      "",
      "Top fabrication signals:",
      patterns,
      "",
      `Log: ${logFilePath()}`,
      `Updated: ${new Date(stats.lastUpdated).toLocaleString()}`,
      "",
      "Run /hallucination recent [N] to see individual events.",
    ].join("\n"),
  );
}
