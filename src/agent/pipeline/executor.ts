import type { AIProvider } from "../../providers/types.js";
import type { PipelineStep, PipelineResult } from "./types.js";
import { matchRoute } from "../router.js";
import { intentMap } from "../intentMap.js";
import { aiIntentRouter } from "../AiRouter.js";
import { getFastModel } from "../../providers/utils.js";
import { exportSink } from "../handlers/export.js";

/**
 * Special sink commands that consume the previous result.
 * They receive the accumulated text via the `__pipe__` prefix.
 */
const SINK_COMMANDS = new Set(["export", "save", "write", "download"]);

/**
 * Execute a parsed pipeline, threading each step's output as context
 * into the next step.
 *
 * For source steps  → run the normal handler, capture `.text`
 * For sink steps    → pass the accumulated text to the sink handler
 */
export async function executePipeline(
  steps: PipelineStep[],
  provider: AIProvider,
  model: string | undefined,
): Promise<PipelineResult> {
  const fastModel = getFastModel(provider.name);
  const executedSteps: string[] = [];
  let accumulated = "";

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isSink = SINK_COMMANDS.has(step.command);

    if (isSink) {
      // Sink: pass accumulated text + original args
      const result = await exportSink(accumulated, step.command, step.args);
      accumulated = result.text;
      executedSteps.push(`${step.command}(${step.args})`);
      continue;
    }

    // Source / transform step
    // Reconstruct a natural-language input for the handler.
    // If there is prior accumulated text, inject it as a "__pipe__" context
    // so transform steps (e.g. summarize) can work on it.
    const effectiveInput =
      accumulated.length > 0 && i > 0
        ? `${step.raw}\n\n__pipe__:\n${accumulated}`
        : step.raw;

    // 1. Try regex router first
    const regexHandler = matchRoute(step.raw);
    if (regexHandler) {
      const result = await regexHandler(provider, effectiveInput, model);
      accumulated = result.text;
      executedSteps.push(step.command);
      continue;
    }

    // 2. Try input map by exact command name
    const directHandler = intentMap[step.command];
    if (directHandler) {
      const result = await directHandler(provider, effectiveInput, model);
      accumulated = result.text;
      executedSteps.push(step.command);
      continue;
    }

    // 3. Fallback to AI intent router
    const intent = await aiIntentRouter(provider, step.raw, fastModel);
    const aiHandler = intentMap[intent];
    if (aiHandler) {
      const result = await aiHandler(provider, effectiveInput, model);
      accumulated = result.text;
      executedSteps.push(step.command);
      continue;
    }

    // 4. No handler found: treat as raw LLM call (escape hatch)
    accumulated = `[Pipeline error] Unknown command: "${step.command}"`;
    executedSteps.push(`${step.command}(unknown)`);
    break;
  }

  return {
    text: accumulated,
    steps: executedSteps,
    isPipeline: steps.length > 1,
  };
}
