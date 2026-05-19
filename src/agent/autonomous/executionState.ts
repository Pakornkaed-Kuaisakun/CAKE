// src/agent/autonomous/executionState.ts
import { compressToolOutput } from "../toolOutputCompresser.js";

export interface StepRecord {
  step: number;
  tool: string;
  inputPreview: string;  // first 80 chars only
  outputSummary: string; // compressed, max 100 chars
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

export const SUMMARY_INTERVAL = 5;  // regenerate summary every 5 steps
export const WINDOW_SIZE = 3;        // keep last 3 steps verbatim

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
  // Reuse heuristic compressor
  const compressed = compressToolOutput(tool, output);
  return compressed.summary.slice(0, 120);
}

/** Regenerate the progress summary (called every SUMMARY_INTERVAL steps) */
export function buildProgressSummary(state: ExecutionState): string {
  const done = state.completedSteps.filter(s => s.success);
  const failed = state.completedSteps.filter(s => !s.success);

  const doneStr = done.map(s => `✓ Step ${s.step} [${s.tool}]: ${s.outputSummary}`).join('\n');
  const failedStr = failed.length > 0
    ? `\nFailed: ${failed.map(s => `[${s.tool}] ${s.inputPreview}`).join(', ')}`
    : '';

  return `Progress (${done.length}/${state.completedSteps.length} succeeded):\n${doneStr}${failedStr}`;
}

/** Build the planner message using compressed state */
export function buildPlannerMessage(state: ExecutionState, stepNum: number): string {
  const parts: string[] = [`GOAL: ${state.goal}\n`];

  if (state.progressSummary && state.completedSteps.length > WINDOW_SIZE) {
    parts.push(`PROGRESS SUMMARY (steps 1-${state.completedSteps.length - WINDOW_SIZE}):\n${state.progressSummary}`);
  }

  if (state.recentSteps.length > 0) {
    parts.push('RECENT STEPS:');
    for (const s of state.recentSteps) {
      const status = s.success ? '✓' : '✗';
      parts.push(`${status} Step ${s.step} [${s.tool}]: ${s.inputPreview}\n   → ${s.outputSummary}`);
    }
  }

  if (state.failedTools.size > 0) {
    parts.push(`\nAVOID (already failed): ${[...state.failedTools].join(', ')}`);
  }

  parts.push(`\nWhat is step ${stepNum}?`);

  return parts.join('\n');
}
