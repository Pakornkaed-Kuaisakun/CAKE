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
 * BUG FIX: getFastModel() returns `string | undefined` — for unknown or
 * future providers it returns undefined. The original code passed that
 * undefined directly to aiIntentRouter(), which then called getFastModel()
 * again internally, creating a redundant double-lookup and potentially using
 * the wrong model if the inner call also returned undefined.
 *
 * Fix: build a single resolved model string at the top of the function using
 * a fallback chain: fast model → caller-supplied model → undefined.
 * This value is reused for every step so there is exactly one lookup per
 * pipeline execution, and aiIntentRouter always receives a concrete string
 * (or undefined as a deliberate "use your own default" signal).
 */
export async function executePipeline(
  steps: PipelineStep[],
  provider: AIProvider,
  model: string | undefined,
): Promise<PipelineResult> {
  // Resolve once at the top. Prefer the provider's fast model; fall back to
  // the caller-supplied model; leave undefined only as a last resort so that
  // downstream functions can apply their own defaults.
  const fastModel = getFastModel(provider.name) ?? model;

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

    // 3. Fallback to AI intent router — use the resolved fastModel so we
    //    never accidentally double-call getFastModel() with undefined
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
