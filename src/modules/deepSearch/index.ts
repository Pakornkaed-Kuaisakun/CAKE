// src/modules/deepSearch/index.ts
//
// Deep search orchestrator — runs planner → parallel search → synthesis.
//
// Usage:
//   const result = await deepSearch(provider, "latest developments in fusion energy", {
//     maxQueries: 5,
//     autoExport: true,
//     onProgress: (step) => console.log(step.message),
//   });

import type { AIProvider } from "../../providers/types.js";
import { planQueries } from "./planner.js";
import { collectHits } from "./collector.js";
import { synthesizeReport } from "./synthesizer.js";
import type { DeepSearchOptions, DeepSearchResult } from "./types.js";
import { exportSink } from "../../agent/handlers/export.js";
import path from "path";

export * from "./types.js";

const DEFAULT_OPTIONS: Required<
  Omit<DeepSearchOptions, "onProgress" | "exportFilename" | "model">
> = {
  maxQueries: 5,
  resultsPerQuery: 4,
  autoExport: false,
};

export async function deepSearch(
  provider: AIProvider,
  userQuery: string,
  options: DeepSearchOptions = {},
): Promise<DeepSearchResult> {
  const {
    maxQueries = DEFAULT_OPTIONS.maxQueries,
    resultsPerQuery = DEFAULT_OPTIONS.resultsPerQuery,
    autoExport = DEFAULT_OPTIONS.autoExport,
    exportFilename,
    model,
    onProgress,
  } = options;

  const query = userQuery.trim();

  // ── Phase 1: Planning ─────────────────────────────────────────────────────
  onProgress?.({
    phase: "planning",
    message: "Planning research strategy…",
    pct: 5,
  });

  const subQueries = await planQueries(provider, query, maxQueries, model);

  onProgress?.({
    phase: "planning",
    message: `Generated ${subQueries.length} research angles`,
    pct: 15,
  });

  // ── Phase 2: Parallel search ──────────────────────────────────────────────
  let searchedCount = 0;
  const hits = await collectHits(subQueries, resultsPerQuery, (q, i, total) => {
    searchedCount++;
    const searchPct = 15 + Math.round((i / total) * 55);
    onProgress?.({
      phase: "searching",
      message: `Searching: "${q.length > 60 ? q.slice(0, 57) + "…" : q}"`,
      pct: searchPct,
    });
  });

  onProgress?.({
    phase: "searching",
    message: `Collected ${hits.length} unique sources`,
    pct: 70,
  });

  // ── Phase 3: Synthesis ────────────────────────────────────────────────────
  onProgress?.({
    phase: "synthesizing",
    message: "Synthesizing report…",
    pct: 75,
  });

  const report = await synthesizeReport(
    provider,
    query,
    subQueries,
    hits,
    model,
  );

  // ── Phase 4: Optional export ──────────────────────────────────────────────
  let exportPath: string | undefined;

  if (autoExport) {
    const filename = exportFilename ?? `deep-search-${Date.now()}.md`;
    const rawArgs = `md ${filename}`;
    try {
      const exportResult = await exportSink(report, "deep_search", rawArgs);
      const match = exportResult.text.match(/Exported to (.+?)\s/);
      exportPath = match?.[1] ?? filename;
    } catch {
      // non-fatal — report is still returned
    }
  }

  onProgress?.({ phase: "done", message: "Research complete", pct: 100 });

  return {
    query,
    subQueries,
    hits,
    report,
    completedAt: new Date().toISOString(),
    exportPath,
  };
}
