// src/agent/autonomous/executor.ts
//
// Changes from original:
//
// FIX 1 — Goal decomposition: calls planGoal() before the step loop to get a
//   GoalPlan. The planner now has a "mental model" of what done looks like.
//
// FIX 2 — Async tracking: the executor tracks pendingAsyncId and passes it
//   into PlannerContext so the planner is forced to poll before moving on.
//
// FIX 3 — Context compression: passes PlannerContext to planNextStepWithContext()
//   instead of a raw message. Full output is only retained for the last step.
//
// FIX 4 — Retry classification: uses categoriseFailure() to decide whether
//   to retry the same tool (transient), switch approach (permanent), or poll
//   an async task (async_pending). Hard limit of 2 retries per plan step.
//
// FIX 5 — Planning/execution separation: planGoal() runs once upfront;
//   planNextStepWithContext() just selects the next move from the plan.

import type { AIProvider } from "../../providers/types.js";
import type { AutonomousResult, StepResult } from "./types.js";
import {
  planGoal,
  planNextStepWithContext,
  categoriseFailure,
  type GoalPlan,
  type PlannerContext,
} from "./planner.js";
import { getToolRunner } from "./toolRegistry.js";
import {
  type ExecutionState,
  SUMMARY_INTERVAL,
  WINDOW_SIZE,
  recordStep,
  buildProgressSummary,
} from "./executionState.js";
import crypto from "crypto";
import { CheckpointManager } from "./checkpoint.js";
import { getFastModel, getFullModel } from "../../providers/utils.js";

const DEFAULT_MAX_STEPS = 20;
const ASYNC_POLL_DELAY_MS = 250;

const ASYNC_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ASYNC_ACTIVE_STATUSES = new Set(["pending", "running"]);

export interface ExecutorOptions {
  maxSteps?: number;
  onStep?: (step: StepResult) => void;
  model?: string;
  plannerModel?: string;
  workerModel?: string;
  signal?: AbortSignal;
  resumeFromCheckpoint?: boolean;
}

export async function executeAutonomous(
  provider: AIProvider,
  goal: string,
  options: ExecutorOptions = {},
): Promise<AutonomousResult> {
  const {
    maxSteps = DEFAULT_MAX_STEPS,
    onStep,
    model,
    plannerModel,
    workerModel,
    signal,
    resumeFromCheckpoint = false,
  } = options;

  const resolvedPlannerModel =
    plannerModel || getFastModel(provider.name) || model;
  const resolvedWorkerModel =
    workerModel || model || getFullModel(provider.name);

  const goalId = crypto
    .createHash("sha256")
    .update(goal + Date().toString())
    .digest("hex");
  const checkpointMgr = new CheckpointManager();
  const existing = resumeFromCheckpoint ? checkpointMgr.load(goalId) : null;

  // ── FIX 1: Upfront goal decomposition ─────────────────────────────────────
  // planGoal() runs ONCE before any tool calls, giving the planner a mental
  // model of what "done" means and what sequence makes sense.
  let goalPlan: GoalPlan;
  try {
    goalPlan = await planGoal(provider, goal, resolvedPlannerModel);
  } catch {
    // Non-fatal: fall back to a single-step plan
    goalPlan = {
      steps: [
        {
          objective: goal,
          tool: "chat",
          dependsOn: -1,
          allowedDuringAsync: false,
        },
      ],
      successCriterion: "Goal completed.",
    };
  }

  // ── State initialisation ───────────────────────────────────────────────────
  let state: ExecutionState;
  let startStep = 1;

  if (existing) {
    state = normalizeExecutionState(existing.state, goal);
    startStep = existing.stepNum + 1;
  } else {
    if (!resumeFromCheckpoint) {
      checkpointMgr.cleanup(goalId);
    }
    state = {
      goal,
      completedSteps: [],
      progressSummary: "",
      recentSteps: [],
      failedTools: new Set(),
    };
  }

  const steps: StepResult[] = [];

  if (existing) {
    for (const s of state.completedSteps) {
      steps.push({
        step: s.step,
        thought: "Restored from checkpoint",
        tool: s.tool,
        input: s.inputPreview,
        output: s.outputSummary,
        success: s.success,
      });
    }
  }

  let finalAnswer = "";
  let success = false;

  // FIX 2: Track pending async task ID across steps
  let pendingAsyncId: string | undefined;
  // FIX 4: Track consecutive retries for the current planned step
  let currentPlanIndex = 0;
  let retryCount = 0;

  for (let stepNum = startStep; stepNum <= maxSteps; stepNum++) {
    if (signal?.aborted) break;

    // Regenerate progress summary every N steps
    if (stepNum > 1 && (stepNum - 1) % SUMMARY_INTERVAL === 0) {
      state.progressSummary = buildProgressSummary(state);
    }

    // ── FIX 3 + FIX 5: Build rich PlannerContext ───────────────────────────
    // The planner receives the full plan, current position, and async state
    // instead of a raw concatenated message string.
    const plannerCtx: PlannerContext = {
      goal,
      plan: goalPlan,
      currentPlanIndex,
      completedSteps: state.completedSteps.map((s) => ({
        step: s.step,
        tool: s.tool,
        inputPreview: s.inputPreview,
        outputSummary: s.outputSummary,
        fullOutput: s.fullOutput,
        success: s.success,
        failureCategory: s.success
          ? undefined
          : categoriseFailure(s.tool, s.fullOutput ?? s.outputSummary),
      })),
      pendingAsyncId,
      retryCount,
    };

    let planned;
    try {
      planned = await planNextStepWithContext(
        provider,
        plannerCtx,
        stepNum,
        resolvedPlannerModel,
      );
    } catch (err: any) {
      finalAnswer = `Stopped: planner error: ${err.message}`;
      break;
    }

    let { thought, tool, input } = planned;

    if (pendingAsyncId) {
      const isAsyncStatusTool =
        tool === "async_status" || tool === "background_status";
      if (!isAsyncStatusTool) {
        thought =
          "Polling the in-flight async task before continuing with dependent work.";
        tool = "async_status";
        input = pendingAsyncId;
      } else if (!input.includes(pendingAsyncId)) {
        input = pendingAsyncId;
      }
    }

    if (tool === "finish") {
      finalAnswer = input;
      success = true;
      steps.push({
        step: stepNum,
        thought,
        tool,
        input,
        output: input,
        success: true,
      });
      onStep?.({
        step: stepNum,
        thought,
        tool,
        input,
        output: input,
        success: true,
      });
      checkpointMgr.cleanup(goalId);
      break;
    }

    if (tool === "export") {
      const resolvedInput = resolveExportInput(input, state);
      if (
        resolvedInput === input &&
        shouldDelegateInlineExportToChatExport(input)
      ) {
        tool = "chat_export";
        input = buildChatExportInputFromInlineExport(input, goal);
        thought = `${thought} Long inline export content looked truncation-prone, so composing via chat_export instead.`;
      } else {
        input = resolvedInput;
      }
    }

    const runner = getToolRunner(tool);
    let rawOutput: string;
    let stepSuccess = true;

    if (!runner) {
      rawOutput = `Unknown tool "${tool}". Use only listed tools.`;
      stepSuccess = false;
    } else {
      try {
        rawOutput = await runner(provider, input, resolvedWorkerModel);
        if (isToolOutputFailure(rawOutput)) {
          stepSuccess = false;
        }
      } catch (err: any) {
        rawOutput = `Tool error: ${err.message}`;
        stepSuccess = false;
      }
    }

    // ── FIX 2: Detect async task launch ───────────────────────────────────
    // If this step queued an async task, record its ID so the next planner
    // call knows it must poll before using dependent results.
    if (stepSuccess && (tool === "async" || tool === "background")) {
      const idMatch = rawOutput.match(
        /Queued background task ([a-f0-9-]{36})/i,
      );
      if (idMatch) {
        pendingAsyncId = idMatch[1];
      }
    }

    // If we just checked an async task status, clear pendingAsyncId on completion
    if (tool === "async_status" || tool === "background_status") {
      const status = extractAsyncStatus(rawOutput);
      if (status && ASYNC_TERMINAL_STATUSES.has(status)) {
        pendingAsyncId = undefined;
      }
      if (status && ASYNC_ACTIVE_STATUSES.has(status)) {
        await delay(ASYNC_POLL_DELAY_MS);
      }
    }

    // ── FIX 4: Failure classification & retry logic ────────────────────────
    if (!stepSuccess) {
      const failCat = categoriseFailure(tool, rawOutput);

      if (failCat === "transient" && retryCount < 2) {
        // Retry the same step — don't advance currentPlanIndex
        retryCount++;
      } else if (failCat === "async_pending") {
        // Not actually a failure — just needs a poll step next
        // Don't count as retry; planner will insert async_status automatically
        retryCount = 0;
      } else {
        // Permanent failure or exhausted retries — advance past this plan step
        if (currentPlanIndex < goalPlan.steps.length - 1) {
          currentPlanIndex++;
        }
        retryCount = 0;
      }
    } else {
      // Step succeeded — advance the plan pointer if we completed the current objective
      retryCount = 0;
      const expectedTool = goalPlan.steps[currentPlanIndex]?.tool;
      if (
        tool === expectedTool ||
        tool === "chat_export" ||
        tool === "export"
      ) {
        if (currentPlanIndex < goalPlan.steps.length - 1) {
          currentPlanIndex++;
        }
      }
    }

    recordStep(state, stepNum, tool, input, rawOutput, stepSuccess);

    const result: StepResult = {
      step: stepNum,
      thought,
      tool,
      input,
      output: rawOutput,
      success: stepSuccess,
    };
    steps.push(result);
    onStep?.(result);

    checkpointMgr.save({ goalId, goal, stepNum, state, timestamp: Date.now() });

    if (stepNum === maxSteps) {
      finalAnswer = `Reached ${maxSteps} step limit. Last: ${state.recentSteps.at(-1)?.outputSummary ?? rawOutput.slice(0, 200)}`;
      checkpointMgr.cleanup(goalId);
    }
  }

  return { goal, steps, finalAnswer, success, stepsUsed: steps.length };
}

function normalizeExecutionState(
  state: ExecutionState | undefined,
  fallbackGoal: string,
): ExecutionState {
  const completedSteps = Array.isArray(state?.completedSteps)
    ? state.completedSteps
    : [];
  const recentSteps = Array.isArray(state?.recentSteps)
    ? state.recentSteps
    : completedSteps.slice(-WINDOW_SIZE);
  const failedTools =
    state?.failedTools instanceof Set
      ? state.failedTools
      : new Set<string>(
          Array.isArray(state?.failedTools) ? state.failedTools : [],
        );

  return {
    goal: state?.goal ?? fallbackGoal,
    completedSteps,
    progressSummary: state?.progressSummary ?? "",
    recentSteps,
    failedTools,
  };
}

function isToolOutputFailure(output: string): boolean {
  return /^(?:Tool error|Unknown tool|Usage:|Task not found|Please provide|Could not cancel|Please specify|\[VDB\] Failed to ingest)\b/i.test(
    output.trim(),
  );
}

function resolveExportInput(input: string, state: ExecutionState): string {
  const pipeIndex = input.indexOf("|");
  if (pipeIndex === -1) return input;

  const header = input.slice(0, pipeIndex + 1);
  const body = input.slice(pipeIndex + 1);
  const placeholderMatch = body.trim().match(/^\{\{step:(\d+)\.output\}\}$/i);

  if (placeholderMatch) {
    const referencedStep = Number(placeholderMatch[1]);
    const output = state.completedSteps.find(
      (step) => step.step === referencedStep,
    )?.fullOutput;
    return output ? `${header}${output}` : input;
  }

  const source = findLatestExportSource(state);
  if (!source?.fullOutput) return input;

  const bodyPreview = body.trim();
  const fullOutput = source.fullOutput;
  const comparablePreview = bodyPreview.slice(0, 240);
  const bodyLooksLikeSource =
    comparablePreview.length > 0 && fullOutput.includes(comparablePreview);
  const bodyLooksTruncated =
    bodyPreview.endsWith("...") ||
    bodyPreview.endsWith("…") ||
    fullOutput.length - body.length > 500;

  if (bodyLooksLikeSource && bodyLooksTruncated) {
    return `${header}${fullOutput}`;
  }

  return input;
}

function findLatestExportSource(state: ExecutionState) {
  const sourceTools = new Set([
    "chat",
    "search",
    "deep_search",
    "file_read",
    "file_summarize",
    "document_read",
    "document_summarize",
  ]);

  for (let i = state.completedSteps.length - 1; i >= 0; i -= 1) {
    const step = state.completedSteps[i];
    if (step.success && step.fullOutput && sourceTools.has(step.tool)) {
      return step;
    }
  }

  return undefined;
}

function shouldDelegateInlineExportToChatExport(input: string): boolean {
  const parsed = parseExportInput(input);
  if (!parsed) return false;

  const body = parsed.body.trim();
  if (body.length < 1200) return false;
  if (body.match(/^\{\{step:\d+\.output\}\}$/i)) return false;

  return (
    body.endsWith("...") ||
    body.endsWith("…") ||
    hasDanglingMarkdownFence(body) ||
    hasDanglingMarkdownTable(body) ||
    !looksLikeCompleteDocument(body)
  );
}

function buildChatExportInputFromInlineExport(
  input: string,
  goal: string,
): string {
  const parsed = parseExportInput(input);
  if (!parsed) return input;

  const draft = parsed.body.trim().slice(0, 4000);
  const prompt = [
    `Write the complete final content for this autonomous goal: ${goal}`,
    "",
    "The planner attempted to inline a draft into an export command, but inline export content may be truncated by planner token limits.",
    "Use the draft below only as guidance for structure and topic. Produce a complete, polished document from beginning to end, and do not stop mid-section.",
    "",
    "Draft/outline:",
    draft,
  ].join("\n");

  return `chat_export ${parsed.rawArgs}|${prompt}`;
}

function parseExportInput(
  input: string,
): { rawArgs: string; body: string } | undefined {
  const withoutVerb = input.replace(/^export\s+/i, "").trim();
  const pipeIndex = withoutVerb.indexOf("|");
  if (pipeIndex === -1) return undefined;

  return {
    rawArgs: withoutVerb.slice(0, pipeIndex).trim(),
    body: withoutVerb.slice(pipeIndex + 1),
  };
}

function hasDanglingMarkdownFence(body: string): boolean {
  const fenceCount = body.match(/```/g)?.length ?? 0;
  return fenceCount % 2 === 1;
}

function hasDanglingMarkdownTable(body: string): boolean {
  const trimmed = body.trimEnd();
  const lastLine = trimmed.split(/\r?\n/).at(-1) ?? "";
  return /^\|.*\|?$/.test(lastLine) && !/[.!?)]$/.test(lastLine.trim());
}

function looksLikeCompleteDocument(body: string): boolean {
  const lowerTail = body.slice(-1000).toLowerCase();
  return (
    lowerTail.includes("## conclusion") ||
    lowerTail.includes("# conclusion") ||
    lowerTail.includes("## references") ||
    lowerTail.includes("# references") ||
    lowerTail.includes("## sources") ||
    lowerTail.includes("# sources")
  );
}

function extractAsyncStatus(output: string): string | undefined {
  return output
    .match(/^Status:\s*(pending|running|completed|failed|cancelled)\b/im)?.[1]
    ?.toLowerCase();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
