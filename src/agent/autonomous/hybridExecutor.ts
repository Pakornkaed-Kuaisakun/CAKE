// src/agent/autonomous/hybridExecutor.ts
import type { AIProvider } from "../../providers/types.js";
import type { AutonomousResult } from "./types.js";
import { ExecutorOptions, executeAutonomous } from "./executor.js";
import { getFastModel } from "../../providers/utils.js";

export interface HybridExecutorOptions extends ExecutorOptions {
  /** Fast model for planning decisions (Haiku, GPT-4o-mini) */
  plannerModel?: string;
  /** Full model for complex tool tasks (writing, analysis) */
  workerModel?: string;
}

export async function executeHybridAutonomous(
  provider: AIProvider,
  goal: string,
  options: HybridExecutorOptions = {},
): Promise<AutonomousResult> {
  const {
    plannerModel = getFastModel(provider.name) ?? options.model, // Haiku for planning
    workerModel = options.model, // Sonnet for work
  } = options;

  // Planning uses fast model, execution uses full model
  // This is transparent to the rest of the executor
  return executeAutonomous(provider, goal, {
    ...options,
    model: plannerModel, // planner uses fast model by default
    workerModel,
    resumeFromCheckpoint: options.resumeFromCheckpoint ?? false,
  });
}
