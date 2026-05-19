import type { AIProvider } from "../../providers/types.js";
import type { AutonomousResult, StepResult } from "./types.js";
import { planNextStep } from "./planner.js";
import { getToolRunner } from "./toolRegistry.js";
import {
  ExecutionState,
  SUMMARY_INTERVAL,
  recordStep,
  buildProgressSummary,
  buildPlannerMessage,
} from "./executionState.js";
import crypto from "crypto";
import { CheckpointManager } from "./checkpoint.js";
import { getFastModel, getFullModel } from "../../providers/utils.js";

const DEFAULT_MAX_STEPS = 20;

export interface ExecutorOptions {
  maxSteps?: number;
  /** Called after each step so the CLI can stream progress  */
  onStep?: (step: StepResult) => void;
  model?: string;
  plannerModel?: string;  // Fast model for planning decisions
  workerModel?: string;   // Full model for complex tool tasks
  signal?: AbortSignal;
}

export async function executeAutonomous(
  provider: AIProvider,
  goal: string,
  options: ExecutorOptions = {},
): Promise<AutonomousResult> {
  const { maxSteps = 20, onStep, model, plannerModel, workerModel, signal } = options;

  // Dynamically resolve appropriate models based on the active provider
  const resolvedPlannerModel = plannerModel || getFastModel(provider.name) || model;
  const resolvedWorkerModel = workerModel || model || getFullModel(provider.name);

  const goalId = crypto.createHash("sha256").update(goal).digest("hex");
  const checkpointMgr = new CheckpointManager();
  const existing = checkpointMgr.load(goalId);

  // Initialize or restore compressed execution state
  let state: ExecutionState;
  let startStep = 1;

  if (existing) {
    state = existing.state;
    startStep = existing.stepNum + 1;
  } else {
    state = {
      goal,
      completedSteps: [],
      progressSummary: '',
      recentSteps: [],
      failedTools: new Set(),
    };
  }

  const steps: StepResult[] = [];
  
  // Reconstruct step results if resuming
  if (existing) {
    for (const step of state.completedSteps) {
      steps.push({
        step: step.step,
        thought: "Restored from checkpoint",
        tool: step.tool,
        input: step.inputPreview,
        output: step.outputSummary,
        success: step.success,
      });
    }
  }

  let finalAnswer = '';
  let success = false;

  for (let stepNum = startStep; stepNum <= maxSteps; stepNum++) {
    if (signal?.aborted) break;

    // Regenerate progress summary every N steps
    if (stepNum > 1 && (stepNum - 1) % SUMMARY_INTERVAL === 0) {
      state.progressSummary = buildProgressSummary(state);
    }

    // Build planner message using compressed state — O(WINDOW_SIZE) not O(stepNum)
    const plannerMessage = buildPlannerMessage(state, stepNum);

    let planned;
    try {
      planned = await planNextStep(provider, plannerMessage, resolvedPlannerModel);
    } catch (err: any) {
      finalAnswer = `Stopped: planner error: ${err.message}`;
      break;
    }

    const { thought, tool, input } = planned;

    if (tool === 'finish') {
      finalAnswer = input;
      success = true;
      steps.push({ step: stepNum, thought, tool, input, output: input, success: true });
      onStep?.({ step: stepNum, thought, tool, input, output: input, success: true });
      checkpointMgr.cleanup(goalId);
      break;
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
      } catch (err: any) {
        rawOutput = `Tool error: ${err.message}`;
        stepSuccess = false;
      }
    }

    // Compress output before storing in state
    recordStep(state, stepNum, tool, input, rawOutput, stepSuccess);

    const result: StepResult = { step: stepNum, thought, tool, input, output: rawOutput, success: stepSuccess };
    steps.push(result);
    onStep?.(result);

    // Save checkpoint after successful recording
    checkpointMgr.save({
      goalId,
      goal,
      stepNum,
      state,
      timestamp: Date.now(),
    });

    if (stepNum === maxSteps) {
      finalAnswer = `Reached ${maxSteps} step limit. Last: ${state.recentSteps.at(-1)?.outputSummary ?? rawOutput.slice(0, 200)}`;
      checkpointMgr.cleanup(goalId);
    }
  }

  return { goal, steps, finalAnswer, success, stepsUsed: steps.length };
}
