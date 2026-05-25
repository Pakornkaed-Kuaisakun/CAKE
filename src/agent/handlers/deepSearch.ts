// src/agent/handlers/deepSearch.ts
//
// Handler for the "deep_search" intent.
//
// Triggers:
//   deep search <topic>
//   research <topic>
//   deep_search <topic>
//   in-depth <topic>
//
// Format:
//   deep search climate change solutions
//   deep search quantum computing | export md
//   deep search AI regulation --export            ← auto-exports to file
//
// The handler streams real-time progress lines and returns a full report.

import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";
import { deepSearch } from "../../modules/deepSearch/index.js";
import type { RunOptions } from "../index.js";

/** Strip the intent verb prefix from the input */
function extractTopic(input: string): string {
  return input
    .replace(
      /^(deep[_\s]?search|deep\s+research|research\s+in[_\s]?depth|in[_\s]?depth|deep)\s+/i,
      "",
    )
    .replace(/--export\b/gi, "")
    .trim();
}

function wantsExport(input: string): boolean {
  return /--export\b/i.test(input);
}

const SEPARATOR = "─".repeat(60);

export async function handleDeepSearch(
  provider: AIProvider,
  input: string,
  model?: string,
  options?: RunOptions,
): Promise<ChatResult> {
  const topic = extractTopic(input);
  const autoExport = wantsExport(input);

  if (!topic) {
    return text(
      [
        "Usage: deep search <topic>",
        "",
        "Examples:",
        "  deep search latest advances in mRNA vaccines",
        "  deep search climate tech startups 2024",
        "  deep search Rust vs Go performance --export",
      ].join("\n"),
    );
  }

  const header = `[DEEP SEARCH] ${topic}\n${SEPARATOR}`;

  if (options?.onChunk) {
    options.onChunk(header + "\n\n");
  }

  const progressLines: string[] = [];

  const result = await deepSearch(provider, topic, {
    maxQueries: 5,
    resultsPerQuery: 4,
    autoExport,
    model,
    onProgress: (step) => {
      const icon =
        step.phase === "planning"
          ? "📋"
          : step.phase === "searching"
            ? "🔍"
            : step.phase === "synthesizing"
              ? "✍️"
              : "✅";

      const line = `${icon} [${step.pct}%] ${step.message}`;
      progressLines.push(line);

      if (options?.onChunk) {
        options.onChunk(line + "\n");
      }
    },
  });

  // Build the full response body
  const subQList = result.subQueries
    .map((q, i) => `  ${i + 1}. ${q.question}`)
    .join("\n");

  const sourceSummary =
    result.hits.length > 0
      ? `\nSources consulted: ${result.hits.length} unique results across ${result.subQueries.length} research angles.`
      : "";

  const exportNote = result.exportPath
    ? `\n\n📄 Report saved to: ${result.exportPath}`
    : "";

  const body = [
    header,
    ...progressLines,
    "",
    SEPARATOR,
    `Research angles:\n${subQList}`,
    sourceSummary,
    "",
    SEPARATOR,
    "",
    result.report,
    exportNote,
  ].join("\n");

  // Stream the report itself if in streaming mode
  if (options?.onChunk) {
    options.onChunk(`\n${SEPARATOR}\n\n`);
    options.onChunk(result.report);
    if (exportNote) options.onChunk(exportNote);
  }

  return text(body);
}
