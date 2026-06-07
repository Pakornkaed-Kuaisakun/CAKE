// src/agent/handlers/autoMemoryStatus.ts
//
// Handler for /memory slash command.
// Shows what AutoMemory has been doing automatically.
//
// Usage:
//   /memory          — show status overview
//   /memory recent   — show recently recorded decisions and facts
//   /memory episode  — show current/recent episodes
//   /memory clear    — reset the current session's episode tracking

import type { AIProvider, ChatResult } from "../../providers/types.js";
import { formatChatResult } from "../../shared/utils/utils.js";
import { EpisodeStore, DecisionStore } from "../../modules/memory/episodes.js";
import { CAKE_DIR } from "../../config/constants.js";
import path from "path";
import fs from "fs";

function fmtDate(ts: number | string): string {
  try {
    return new Date(typeof ts === "number" ? ts : ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export async function handleAutoMemoryStatus(
  _provider: AIProvider,
  args: string[],
  _model?: string,
): Promise<ChatResult> {
  const sub = args[0]?.toLowerCase() ?? "status";

  const episodeStore = new EpisodeStore();
  const decisionStore = new DecisionStore();

  // ── /memory recent ───────────────────────────────────────────────────────
  if (sub === "recent" || sub === "decisions") {
    const decisions = decisionStore.listDecisions(10);

    if (decisions.length === 0) {
      return formatChatResult(
        "[AUTO-MEMORY] No decisions recorded yet.\n\n" +
          "Decisions are recorded automatically when you make a firm choice or agreement.\n" +
          'Try: "I\'ll use TypeScript for this project" or "Let\'s go with option A"',
      );
    }

    const rows = decisions.map((d, i) => {
      const rationale = d.rationale ? `\n   ↳ ${d.rationale}` : "";
      const ep = d.episodeId ? ` [ep:${d.episodeId.slice(0, 8)}]` : "";
      return `${i + 1}. ${d.text}${rationale}\n   ${fmtDate(d.timestamp)}${ep}`;
    });

    return formatChatResult(
      `[AUTO-MEMORY] Last ${decisions.length} auto-recorded decision(s):\n` +
        "─".repeat(50) +
        "\n" +
        rows.join("\n\n"),
    );
  }

  // ── /memory episodes ─────────────────────────────────────────────────────
  if (sub === "episodes" || sub === "episode") {
    const episodes = episodeStore.listEpisodes().slice(0, 10);
    const active = episodeStore.getActiveEpisode();

    if (episodes.length === 0) {
      return formatChatResult(
        "[AUTO-MEMORY] No episodes recorded yet.\n\n" +
          "Episodes are started automatically when you begin working on a substantial topic.\n" +
          'Try: "Let\'s design the authentication system" or "Help me plan this project"',
      );
    }

    const rows = episodes.map((ep) => {
      const status = !ep.end ? "🟢 active" : "✅ ended";
      const duration = ep.end
        ? `${Math.round((ep.end - ep.start) / 60000)} min`
        : "ongoing";
      const summary = ep.summary
        ? `\n   Summary: ${ep.summary.slice(0, 80)}…`
        : "";
      return `• [${ep.id.slice(0, 8)}] "${ep.title}"\n  ${status} · ${fmtDate(ep.start)} · ${duration}${summary}`;
    });

    return formatChatResult(
      `[AUTO-MEMORY] Episodes (${active ? "1 active" : "none active"}):\n` +
        "─".repeat(50) +
        "\n" +
        rows.join("\n\n"),
    );
  }

  // ── /memory facts ─────────────────────────────────────────────────────────
  if (sub === "facts" || sub === "index") {
    const vectorFile = path.join(CAKE_DIR, "memory", "vectors.json");
    try {
      if (!fs.existsSync(vectorFile)) {
        return formatChatResult("[AUTO-MEMORY] No facts indexed yet.");
      }
      const entries = JSON.parse(fs.readFileSync(vectorFile, "utf-8"));
      const autoExtracted = entries.filter(
        (e: any) => e.metadata?.source === "auto-extract",
      );

      if (autoExtracted.length === 0) {
        return formatChatResult(
          "[AUTO-MEMORY] No facts auto-extracted yet.\n\n" +
            "Facts are indexed automatically from important information you share.",
        );
      }

      const recent = autoExtracted.slice(-10).reverse();
      const rows = recent.map((e: any, i: number) => {
        const type = e.metadata?.type ?? "fact";
        const conf = e.metadata?.confidence
          ? ` (${Math.round(e.metadata.confidence * 100)}%)`
          : "";
        return `${i + 1}. [${type}]${conf} ${e.text.slice(0, 100)}`;
      });

      return formatChatResult(
        `[AUTO-MEMORY] ${autoExtracted.length} auto-extracted fact(s) — showing last 10:\n` +
          "─".repeat(50) +
          "\n" +
          rows.join("\n"),
      );
    } catch {
      return formatChatResult("[AUTO-MEMORY] Could not read memory store.");
    }
  }

  // ── /memory status (default) ──────────────────────────────────────────────
  const active = episodeStore.getActiveEpisode();
  const allDecisions = decisionStore.listDecisions(1000).length;
  const allEpisodes = episodeStore.listEpisodes().length;

  const vectorFile = path.join(CAKE_DIR, "memory", "vectors.json");
  let totalMemories = 0;
  let autoMemories = 0;
  try {
    if (fs.existsSync(vectorFile)) {
      const entries = JSON.parse(fs.readFileSync(vectorFile, "utf-8"));
      totalMemories = entries.length;
      autoMemories = entries.filter(
        (e: any) => e.metadata?.source === "auto-extract",
      ).length;
    }
  } catch {}

  return formatChatResult(
    [
      "[AUTO-MEMORY] Status — everything runs automatically",
      "─".repeat(50),
      "",
      "📊 Stats:",
      `  Total memories      : ${totalMemories} (${autoMemories} auto-extracted)`,
      `  Decisions recorded  : ${allDecisions} (auto)`,
      `  Episodes tracked    : ${allEpisodes}`,
      `  Active episode      : ${active ? `"${active.title}"` : "none"}`,
      "",
      "⚙️  What runs automatically:",
      "  • Decision detection    — every conversation turn",
      "  • Fact extraction       — when important info detected",
      "  • Episode tracking      — starts/ends by topic",
      "  • Self-reflection       — every 20 turns",
      "  • Context injection     — relevant memories surface before responses",
      "",
      "📌 Sub-commands:",
      "  /memory recent    — show auto-recorded decisions",
      "  /memory episodes  — show conversation episodes",
      "  /memory facts     — show auto-extracted facts",
    ].join("\n"),
  );
}
