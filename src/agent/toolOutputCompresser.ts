// src/agent/toolOutputCompressor.ts

export interface CompressedToolOutput {
  /** Short summary shown in conversation history (< 100 tokens) */
  summary: string;
  /** Full raw output stored only in vector/database layer */
  fullOutput: string;
  /** Token count estimate of full output */
  estimatedTokens: number;
  /** Tool that produced this */
  toolName: string;
}

const COMPRESSION_THRESHOLD_CHARS = 500; // ~125 tokens

/** Synchronous heuristic compressor — no LLM call needed */
export function compressToolOutput(
  toolName: string,
  rawOutput: string,
): CompressedToolOutput {
  const estimatedTokens = Math.ceil(rawOutput.length / 4);

  if (rawOutput.length <= COMPRESSION_THRESHOLD_CHARS) {
    return {
      summary: rawOutput,
      fullOutput: rawOutput,
      estimatedTokens,
      toolName,
    };
  }

  // Generate compact structured summary based on tool type
  const summary = buildStructuredSummary(toolName, rawOutput);

  return { summary, fullOutput: rawOutput, estimatedTokens, toolName };
}

function buildStructuredSummary(tool: string, output: string): string {
  const lines = output.split("\n").filter(Boolean);
  const lineCount = lines.length;

  switch (tool) {
    case "news":
      // Extract just the article count and topic
      const articleMatches = output.match(/• \[([^\]]+)\]/g) ?? [];
      return `[Tool:news] Found ${articleMatches.length} articles. Topics: ${articleMatches
        .slice(0, 3)
        .map((m) => m.replace(/[•\[\]]/g, ""))
        .join(", ")}${articleMatches.length > 3 ? "…" : ""}`;

    case "email":
      const emailMatches = output.match(/• (.+)\n/g) ?? [];
      return `[Tool:email] Fetched ${emailMatches.length} emails. Latest: ${
        emailMatches[0]?.replace("• ", "").slice(0, 60) ?? "none"
      }`;

    case "directory_tree":
    case "file_list":
      const fileCount = (output.match(/\[FILE\]/g) ?? []).length;
      const dirCount = (output.match(/\[DIR\]/g) ?? []).length;
      const firstPath = lines[0]?.slice(0, 60) ?? "";
      return `[Tool:${tool}] ${fileCount} files, ${dirCount} dirs in ${firstPath}`;

    case "bash":
      const exitMatch = output.match(/Exit code: (\d+)/);
      const preview = lines.slice(1, 4).join(" ").slice(0, 120);
      return `[Tool:bash] Exit ${exitMatch?.[1] ?? "0"}. Output: ${preview}${lineCount > 4 ? `… (+${lineCount - 4} lines)` : ""}`;

    case "search":
      const resultCount = (output.match(/\[\d+\]/g) ?? []).length;
      return `[Tool:search] ${resultCount} results found. ${lines[1]?.slice(0, 80) ?? ""}`;

    case "calendar_list":
      const eventCount = (output.match(/•/g) ?? []).length;
      return `[Tool:calendar] ${eventCount} upcoming events listed.`;

    case "todo_list":
      const todoCount = (output.match(/•/g) ?? []).length;
      return `[Tool:todo] ${todoCount} pending tasks.`;

    case "weather":
      const tempMatch = output.match(/(\d+)°C/);
      return `[Tool:weather] ${tempMatch?.[0] ?? "fetched"}. ${lines[1]?.slice(0, 80) ?? ""}`;

    case "file_read":
    case "file_summarize":
    case "document_summarize":
      return `[Tool:${tool}] Processed ${lineCount} lines. First: "${lines[1]?.slice(0, 80) ?? ""}"`;

    default:
      // Generic: first meaningful line + stats
      const firstMeaningful =
        lines.find((l) => l.length > 20) ?? lines[0] ?? "";
      return `[Tool:${tool}] ${firstMeaningful.slice(0, 100)}${lineCount > 1 ? ` (+${lineCount - 1} more lines)` : ""}`;
  }
}

/**
 * Async version using LLM for complex outputs where structure is unclear.
 * Only called when heuristic summary would lose critical semantic information.
 */
export async function compressToolOutputWithLLM(
  provider: import("../providers/types.js").AIProvider,
  toolName: string,
  rawOutput: string,
  fastModel?: string,
): Promise<CompressedToolOutput> {
  const estimatedTokens = Math.ceil(rawOutput.length / 4);

  // Don't bother with LLM for small outputs
  if (rawOutput.length <= COMPRESSION_THRESHOLD_CHARS) {
    return {
      summary: rawOutput,
      fullOutput: rawOutput,
      estimatedTokens,
      toolName,
    };
  }

  try {
    const result = await provider.chat(
      [
        {
          role: "user",
          content: `Summarize this tool output in ONE concise line (max 150 chars). Format: "[Tool:${toolName}] <key result>"\n\nOutput:\n${rawOutput.slice(0, 2000)}`,
        },
      ],
      {
        model: fastModel,
        maxTokens: 60,
        temperature: 0,
      },
    );

    return {
      summary: result.text.trim().slice(0, 200),
      fullOutput: rawOutput,
      estimatedTokens,
      toolName,
    };
  } catch {
    return compressToolOutput(toolName, rawOutput);
  }
}
