import type { AIProvider, ChatResult } from "../../providers/types.js";
import { executeHybridAutonomous } from "../autonomous/index.js";
import { AGENT_TOOLS } from "../autonomous/toolRegistry.js";
import { text } from "../utils/text.js";
import type { RunOptions } from "../index.js";
import { stripVerb } from "../../shared/utils/utils.js";

/**
 * Strips the trigger prefix from the user input to extract the bare goal.
 * Handles:
 *   "auto <goal>"
 *   "agent <goal>"
 *   "autonomous <goal>"
 *   "run agent <goal>"
 *   "run auto <goal>"
 */
function extractGoal(input: string): string {
  return stripVerb(input, [
    "run agent",
    "run auto",
    "run autonomous",
    "agent",
    "auto",
    "autonomous",
  ]);
}

/**
 * Format a step result into a displayable line.
 * Returns the formatted string for both real-time output and final summary.
 */
function formatStep(step: {
  step: number;
  tool: string;
  thought: string;
  input: string;
  output: string;
  success: boolean;
}): string {
  const icon = step.tool === "finish" ? "✅" : step.success ? "▶" : "⚠️";
  const inputPreview =
    step.input.length > 120 ? step.input.slice(0, 120) + "…" : step.input;

  // Show a brief output preview for real-time feedback
  const outputPreview = step.output
    ? step.output
        .split("\n")
        .slice(0, 2)
        .join(" ")
        .slice(0, 100)
        .replace(/\s+/g, " ")
        .trim()
    : "";

  const lines = [
    `${icon} Step ${step.step}: [${step.tool}]`,
    `  └─ [Thinking]: ${step.thought}`,
    `  └─ [Input]: ${inputPreview}`,
  ];

  if (outputPreview && step.tool !== "finish") {
    lines.push(
      `  └─ [Output]: ${outputPreview}${step.output.length > 100 ? "…\n" : "\n"}`,
    );
  }

  return lines.join("\n");
}


export async function handleAutonomous(
  provider: AIProvider,
  input: string,
  model?: string,
  options?: RunOptions,
): Promise<ChatResult> {
  const goal = extractGoal(input);
  if (!goal) {
    const toolNames = AGENT_TOOLS.map(
      (t) => `  • ${t.name} — ${t.description}`,
    ).join("\n");
    return text(
      `[AGENT] Usage: auto <goal>\n\nExample:\n  auto Research the top 3 Node.js HTTP frameworks and save a comparison to md\n\nAvailable tools:\n${toolNames}`,
    );
  }

  const separator = "─".repeat(100);
  const header = `[AGENT] Goal: ${goal}\n${separator}`;

  // ── Real-time streaming to terminal ──────────────────────────────────────
  // Write header immediately so the user sees the agent has started
  if (options?.onChunk) {
    options.onChunk(header + "\n\n");
  } else {
    process.stdout.write("\n" + header + "\n");
  }

  const stepLines: string[] = [];

    const result = await executeHybridAutonomous(provider, goal, {
      maxSteps: 10,
      model,
      signal: options?.signal,
      recentResults: options?.recentResults,
      onStep: (step) => {
      const line = formatStep(step);
      stepLines.push(line);

      // Stream each step immediately to the terminal as it completes
      // This provides real-time feedback during long-running autonomous tasks
      if (options?.onChunk) {
        options.onChunk(line + "\n\n");
      } else {
        process.stdout.write("\n" + line + "\n");
      }
    },
  });

  // Write the final summary line to terminal immediately as well
  const summaryLine = result.success
    ? `${separator}\n✅ Done in ${result.stepsUsed} step${result.stepsUsed !== 1 ? "s" : ""}.\n`
    : `${separator}\n⚠️  Stopped after ${result.stepsUsed} steps.\n`;

  if (options?.onChunk) {
    options.onChunk(summaryLine);
    if (result.finalAnswer) {
      options.onChunk(result.finalAnswer + "\n");
    }
  } else {
    process.stdout.write("\n" + summaryLine);
    if (result.finalAnswer) {
      process.stdout.write(result.finalAnswer + "\n");
    }
  }

  // ── Return full body for Ink's MessageList ────────────────────────────────
  // The Ink UI will also display this as an assistant message, so we
  // compose the complete text for the chat history.
  const body = [
    header,
    stepLines.join("\n\n"),
    "",
    separator,
    result.success
      ? `✅ Done in ${result.stepsUsed} step${result.stepsUsed !== 1 ? "s" : ""}.\n\n${result.finalAnswer}`
      : `⚠️  Stopped after ${result.stepsUsed} steps.\n\n${result.finalAnswer}`,
  ].join("\n");

  return text(body);
}
