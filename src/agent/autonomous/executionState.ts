// src/agent/autonomous/executionState.ts
import { compressToolOutput } from "../toolOutputCompresser.js";

export interface StepRecord {
  step: number;
  tool: string;
  inputPreview: string; // first 80 chars only
  outputSummary: string; // compressed, max 120 chars — used for planner context
  /**
   * BUG FIX: fullOutput stores the COMPLETE raw output for tools whose
   * result will be consumed by a subsequent step (e.g. "chat" → "export").
   * Without this, the planner only sees the compressed summary and writes
   * that truncated string into the export file instead of the real content.
   */
  fullOutput?: string;
  success: boolean;
}

export interface ExecutionState {
  goal: string;
  completedSteps: StepRecord[];
  /** Rolling summary, regenerated every SUMMARY_INTERVAL steps */
  progressSummary: string;
  /** Only the last WINDOW_SIZE steps kept verbatim */
  recentSteps: StepRecord[];
  failedTools: Set<string>; // for anti-repeat guidance
}

export const SUMMARY_INTERVAL = 5; // regenerate summary every 5 steps
export const WINDOW_SIZE = 3; // keep last 3 steps verbatim

/**
 * Tools whose full output must be preserved in recentSteps so that a
 * subsequent "export" step can embed the real content into the file.
 * Without this list, compressToolOutput truncates to 120 chars and the
 * agent writes that truncated summary into the exported file.
 */
const FULL_OUTPUT_TOOLS = new Set([
  "chat",
  "search",
  "deep_search",
  "file_read",
  "file_summarize",
  "document_read",
  "document_summarize",
  "export",
  "chat_export",
  "async",
  "async_status",
  "async_list",
]);

export function recordStep(
  state: ExecutionState,
  step: number,
  tool: string,
  input: string,
  rawOutput: string,
  success: boolean,
): void {
  const record: StepRecord = {
    step,
    tool,
    inputPreview: input.slice(0, 80),
    outputSummary: buildOutputSummary(tool, rawOutput),
    // BUG FIX: preserve full output for content-producing tools
    fullOutput: FULL_OUTPUT_TOOLS.has(tool) ? rawOutput : undefined,
    success,
  };

  state.completedSteps.push(record);
  state.recentSteps.push(record);

  // Maintain sliding window
  if (state.recentSteps.length > WINDOW_SIZE) {
    state.recentSteps.shift();
  }

  if (!success) {
    state.failedTools.add(`${tool}:${input.slice(0, 40)}`);
  }
}

function buildOutputSummary(tool: string, output: string): string {
  // Reuse heuristic compressor — this is for planner context display only,
  // NOT for the actual content that gets written to files.
  const compressed = compressToolOutput(tool, output);
  return compressed.summary.slice(0, 120);
}

/** Regenerate the progress summary (called every SUMMARY_INTERVAL steps) */
export function buildProgressSummary(state: ExecutionState): string {
  const done = state.completedSteps.filter((s) => s.success);
  const failed = state.completedSteps.filter((s) => !s.success);

  const doneStr = done
    .map((s) => `✓ Step ${s.step} [${s.tool}]: ${s.outputSummary}`)
    .join("\n");
  const failedStr =
    failed.length > 0
      ? `\nFailed: ${failed.map((s) => `[${s.tool}] ${s.inputPreview}`).join(", ")}`
      : "";

  return `Progress (${done.length}/${state.completedSteps.length} succeeded):\n${doneStr}${failedStr}`;
}

/** Build the planner message using compressed state */
export function buildPlannerMessage(
  state: ExecutionState,
  stepNum: number,
): string {
  const parts: string[] = [`GOAL: ${state.goal}\n`];

  if (state.progressSummary && state.completedSteps.length > WINDOW_SIZE) {
    parts.push(
      `PROGRESS SUMMARY (steps 1-${state.completedSteps.length - WINDOW_SIZE}):\n${state.progressSummary}`,
    );
  }

  if (state.recentSteps.length > 0) {
    parts.push("RECENT STEPS:");
    for (const s of state.recentSteps) {
      const status = s.success ? "✓" : "✗";

      // BUG FIX: For content-producing tools (chat, search, etc.), show the
      // FULL output in the planner context so the next export step can embed
      // the real content into the file via the "|" separator.
      //
      // Without this, the planner only sees the 120-char summary like
      // "#📚 Comprehensive Report (+86 more lines)" and writes THAT into
      // the exported file instead of the actual report content.
      //
      // We cap at 8000 chars to stay within context limits while still
      // giving the planner enough content to pass to export.
      const outputForPlanner = s.fullOutput
        ? s.fullOutput.slice(0, 8000)
        : s.outputSummary;

      parts.push(
        `${status} Step ${s.step} [${s.tool}]: ${s.inputPreview}\n   → ${outputForPlanner}`,
      );
    }
  }

  if (state.failedTools.size > 0) {
    parts.push(
      `\nAVOID (already failed): ${[...state.failedTools].join(", ")}`,
    );
  }

  parts.push(`\nWhat is step ${stepNum}?`);

  return parts.join("\n");
}
