// src/agent/autonomous/parallelPlanner.ts
import type { AIProvider } from "../../providers/types.js";
import { getToolRunner } from "./toolRegistry.js";

export interface ExecutionPlan {
  steps: Array<{
    id: string;
    tool: string;
    input: string;
    dependsOn: string[]; // IDs of steps that must complete first
  }>;
}

/** 
 * Detect which planned steps can run in parallel.
 * Steps with no dependsOn[] run concurrently in the first wave.
 */
export async function executeParallelPlan(
  provider: AIProvider,
  plan: ExecutionPlan,
  model?: string,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const pending = new Set(plan.steps.map(s => s.id));
  const running = new Set<string>();

  while (pending.size > 0) {
    // Find steps whose dependencies are all satisfied
    const ready = plan.steps.filter(s =>
      pending.has(s.id) &&
      !running.has(s.id) &&
      s.dependsOn.every(dep => results.has(dep))
    );

    if (ready.length === 0) break; // deadlock guard

    // Launch all ready steps concurrently
    const wave = ready.map(async step => {
      running.add(step.id);
      pending.delete(step.id);

      const runner = getToolRunner(step.tool);
      if (!runner) {
        results.set(step.id, `Unknown tool: ${step.tool}`);
        return;
      }

      try {
        const output = await runner(provider, step.input, model);
        results.set(step.id, output);
      } catch (err: any) {
        results.set(step.id, `Error: ${err.message}`);
      } finally {
        running.delete(step.id);
      }
    });

    await Promise.all(wave);
  }

  return results;
}
