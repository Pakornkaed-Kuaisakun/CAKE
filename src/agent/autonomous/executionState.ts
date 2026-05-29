// src/agent/autonomous/executionState.ts
//
// Changes from original:
//
// FIX 3 — Context compression: WINDOW_SIZE reduced to 2 (from 3).
//   Full output is only preserved for FULL_OUTPUT_TOOLS and only the
//   immediately-prior step gets it in the planner message (enforced in planner.ts).
//   Older steps are summarised to ≤120 chars regardless of tool type.
//
// FIX 4 — Failure tracking: StepRecord now includes failureCategory so the
//   planner can reason about retry vs replan without re-parsing output.

import { compressToolOutput } from "../toolOutputCompresser.js";
import type { FailureCategory } from "./planner.js";

export interface StepRecord {
  step: number;
  tool: string;
  inputPreview: string; // first 80 chars only
  outputSummary: string; // compressed, max 120 chars — planner context (older steps)
  /**
   * Full raw output for the immediately-prior step only.
   * Tools in FULL_OUTPUT_TOOLS get this preserved so the planner can pass
   * content downstream. The planner ONLY uses this for the last step in the
   * window (see planner.ts buildPlannerMessage).
   */
  fullOutput?: string;
  success: boolean;
  /** FIX 4: Categorised failure type for smarter retry decisions */
  failureCategory?: FailureCategory;
}

export interface ExecutionState {
  goal: string;
  completedSteps: StepRecord[];
  /** Rolling summary regenerated every SUMMARY_INTERVAL steps */
  progressSummary: string;
  /** Only the last WINDOW_SIZE steps kept verbatim */
  recentSteps: StepRecord[];
  failedTools: Set<string>;
}

export const SUMMARY_INTERVAL = 5;

// FIX 3: Reduced from 3 → 2. The planner only needs one recent step with
// full output; a second step with summary is enough for context continuity.
export const WINDOW_SIZE = 2;

/**
 * Tools whose full output must be preserved so a subsequent step can use the
 * actual content (e.g. export step embedding a chat result).
 * Non-listed tools only get their 120-char summary stored.
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
    // Preserve full output for content-producing tools
    fullOutput: FULL_OUTPUT_TOOLS.has(tool) ? rawOutput : undefined,
    success,
    // FIX 4: Attach failure category immediately so it's available to the planner
    failureCategory: success
      ? undefined
      : categoriseFailureSync(tool, rawOutput),
  };

  state.completedSteps.push(record);
  state.recentSteps.push(record);

  // Maintain sliding window — FIX 3: now size 2
  if (state.recentSteps.length > WINDOW_SIZE) {
    state.recentSteps.shift();
  }

  if (!success) {
    state.failedTools.add(`${tool}:${input.slice(0, 40)}`);
  }
}

/**
 * Inline failure categorisation used at record time.
 * Mirrors the logic in planner.ts categoriseFailure() without the import
 * (avoids circular dependency between executionState ↔ planner).
 */
function categoriseFailureSync(tool: string, output: string): FailureCategory {
  const lower = output.toLowerCase();
  if (lower.includes("queued background task") || lower.includes("task id"))
    return "async_pending";
  if (
    lower.includes("timeout") ||
    lower.includes("rate limit") ||
    lower.includes("network") ||
    lower.includes("503") ||
    lower.includes("429")
  )
    return "transient";
  if (
    lower.includes("unknown tool") ||
    lower.includes("not found") ||
    lower.includes("invalid") ||
    lower.includes("usage:")
  )
    return "permanent";
  return "unknown";
}

// Re-export so callers can import from here without importing from planner.ts
export type { FailureCategory };

function buildOutputSummary(tool: string, output: string): string {
  const compressed = compressToolOutput(tool, output);
  // FIX 3: Hard cap at 120 chars for summary (full output is on fullOutput field)
  return compressed.summary.slice(0, 120);
}

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

/**
 * Build the planner message using compressed state.
 *
 * NOTE: This function is still exported for backwards compatibility with
 * hybridExecutor.ts and any other callers. When using the new PlannerContext
 * system (planner.ts planNextStepWithContext), this function is NOT called —
 * the richer context builder in planner.ts is used instead.
 *
 * FIX 3: For the last recent step, show full output (capped at 1500 chars).
 * For all other steps, show only the 120-char summary.
 */
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
    for (let i = 0; i < state.recentSteps.length; i++) {
      const s = state.recentSteps[i];
      const status = s.success ? "✓" : "✗";
      const isLast = i === state.recentSteps.length - 1;

      // FIX 3: Full output only for the immediately-prior step
      const outputForPlanner =
        isLast && s.fullOutput ? s.fullOutput.slice(0, 1500) : s.outputSummary;

      parts.push(
        `${status} Step ${s.step} [${s.tool}]: ${s.inputPreview}\n   → ${outputForPlanner}`,
      );

      // FIX 4: Surface failure category in legacy message format too
      if (!s.success && s.failureCategory) {
        parts.push(`   ⚠ Failure: ${s.failureCategory}`);
      }
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
