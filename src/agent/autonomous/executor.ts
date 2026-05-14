import type { AIProvider } from "../../providers/types.js";
import type { AutonomousResult, StepResult } from "./types.js";
import { planNextStep } from "./planner.js";
import { getToolRunner } from "./toolRegistry.js";

const DEFAULT_MAX_STEPS = 20;

export interface ExecutorOptions {
  maxSteps?: number;
  /** Called after each step so the CLI can stream progress  */
  onStep?: (step: StepResult) => void;
  model?: string;
  signal?: AbortSignal;
}

export async function executeAutonomous(
  provider: AIProvider,
  goal: string,
  options: ExecutorOptions = {},
): Promise<AutonomousResult> {
  const { maxSteps = DEFAULT_MAX_STEPS, onStep, model, signal } = options;

  const history: Array<{ tool: string; input: string; output: string }> = [];
  const steps: StepResult[] = [];
  let finalAnswer = "";
  let success = false;

  for (let stepNum = 1; stepNum <= maxSteps; stepNum++) {
    if (signal?.aborted) {
      finalAnswer = "Autonomous run cancelled by user.";
      break;
    }

    // 1. Plan
    let planned;
    try {
      planned = await planNextStep(provider, goal, history, model);
    } catch (err: any) {
      const result: StepResult = {
        step: stepNum,
        thought: "Planner error",
        tool: "finish",
        input: "",
        output: `Planner failed: ${err.message}`,
        success: false,
      };
      steps.push(result);
      onStep?.(result);
      finalAnswer = `Stopped due to planner error: ${err.message}`;
      break;
    }

    const { thought, tool, input } = planned;

    // 2. Finish check
    if (tool === "finish") {
      finalAnswer = input;
      success = true;
      const result: StepResult = {
        step: stepNum,
        thought,
        tool,
        input,
        output: input,
        success: true,
      };
      steps.push(result);
      onStep?.(result);
      break;
    }

    // 3. Run tool
    const runner = getToolRunner(tool);
    let output: string;
    let stepSuccess = true;

    if (!runner) {
      // Give the planner a targeted hint so it corrects itself next step
      const hint =
        tool === "write_file" || tool === "save"
          ? `Unknown tool "${tool}". To save a file use: export md filename.md|<content>`
          : tool === "file_save" || tool === "file_write"
          ? `Unknown tool "${tool}". Use: export md filename.md|<content> to save files.`
          : `Unknown tool "${tool}". Valid tools: search, bash, file_read, file_summarize, export, chat, finish, and others listed in AVAILABLE TOOLS.`;
      output = hint;
      stepSuccess = false;
    } else {
      try {
        output = await runner(provider, input, model);
      } catch (err: any) {
        output = `Tool "${tool}" threw an error: ${err.message}`;
        stepSuccess = false;
      }
    }

    // Trim very long outputs before feeding back to the planner
    const trimmedOutput =
      output.length > 2000
        ? output.slice(0, 2000) + "\n...[TRUNCATED]"
        : output;

    history.push({ tool, input, output: trimmedOutput });

    const result: StepResult = {
      step: stepNum,
      thought,
      tool,
      input,
      output,
      success: stepSuccess,
    };
    steps.push(result);
    onStep?.(result);

    // 4. Max-steps guard
    if (stepNum === maxSteps) {
      finalAnswer = `Reached maximum step limit (${maxSteps}). Last output:\n${output}`;
    }
  }

  return {
    goal,
    steps,
    finalAnswer,
    success,
    stepsUsed: steps.length,
  };
}
