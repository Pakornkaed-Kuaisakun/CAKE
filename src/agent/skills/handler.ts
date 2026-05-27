// src/agent/skills/handler.ts
//
// Skill-aware handler wrapper.
//
// How it fits in the agent run loop (src/agent/index.ts):
//
//   Before routing:
//     const skill = findBestSkill(input, intent);
//     if (skill) {
//       const result = await runWithSkill(skill, input, provider, model, opts);
//       return result;
//     }
//
// The handler:
//   1. Injects skill context into system prompt
//   2. Resolves model preferences
//   3. Dispatches to the appropriate base handler
//   4. Post-processes output (template, constraints check)
//   5. Marks skill as activated (cooldown)

import type { AIProvider, ChatResult } from "../../providers/types.js";
import type { LoadedSkill } from "./loader.js";
import {
  buildSkillContext,
  markActivated,
  getSkillPrompt,
  getSkillTemplate,
} from "./registry.js";
import { getFastModel, getFullModel } from "../../providers/utils.js";
import type { RunOptions } from "../index.js";

// ── Model resolution ──────────────────────────────────────────────────────────

function resolveSkillModel(
  skill: LoadedSkill,
  provider: AIProvider,
  baseModel?: string,
): string | undefined {
  const prefer = skill.meta.model?.prefer ?? "auto";
  if (prefer === "fast") return getFastModel(provider.name) ?? baseModel;
  if (prefer === "full") return getFullModel(provider.name) ?? baseModel;
  return baseModel; // auto: let caller decide
}

// ── Context injection ─────────────────────────────────────────────────────────

function buildSystemPromptWithSkill(
  skill: LoadedSkill,
  baseSystemPrompt?: string,
): string {
  const skillContext = buildSkillContext(skill);
  if (!skillContext) return baseSystemPrompt ?? "";
  return [baseSystemPrompt, skillContext].filter(Boolean).join("\n\n---\n\n");
}

// ── Constraint guard ──────────────────────────────────────────────────────────

/**
 * Lightweight post-processor: checks if the response violates any
 * hard constraints and appends a warning if so. Not a filter — we
 * never suppress the model's output, only annotate it.
 */
function applyConstraints(text: string, skill: LoadedSkill): string {
  if (!skill.meta.constraints || skill.meta.constraints.length === 0) {
    return text;
  }

  // For now, only the financial "no guarantees" constraint adds a disclosure.
  // Future: per-constraint post-processor registry.
  const needsDisclosure = skill.meta.constraints.some((c) =>
    /never guarantee|no guarantee/i.test(c),
  );

  if (
    needsDisclosure &&
    !/not financial advice|consult.*financial|investment risk/i.test(text)
  ) {
    return (
      text +
      "\n\n---\n⚠️ *This analysis is not financial advice. " +
      "Past performance does not guarantee future results. " +
      "Consult a licensed financial advisor before making investment decisions.*"
    );
  }

  return text;
}

// ── Section template renderer ─────────────────────────────────────────────────

/**
 * If the skill declares output.sections, and the response doesn't already
 * use those headings, inject a brief structural note into the user prompt
 * so the model knows what to produce.
 */
function buildOutputHint(skill: LoadedSkill): string {
  const sections = skill.meta.output?.sections;
  if (!sections || sections.length === 0) return "";

  return (
    `\n\nPlease structure your response with these sections:\n` +
    sections.map((s) => `## ${s}`).join("\n")
  );
}

// ── Main runner ───────────────────────────────────────────────────────────────

export interface SkillRunOptions {
  baseSystemPrompt?: string;
  baseHandler?: (
    provider: AIProvider,
    input: string,
    model?: string,
    opts?: RunOptions,
  ) => Promise<ChatResult>;
}

/**
 * Run an agent request through a skill context.
 *
 * @param skill        - The matched skill
 * @param input        - Raw user input
 * @param provider     - Active AI provider
 * @param model        - Caller's preferred model
 * @param opts         - RunOptions (signal, onChunk, etc.)
 * @param skillOpts    - Optional base handler + system prompt
 */
export async function runWithSkill(
  skill: LoadedSkill,
  input: string,
  provider: AIProvider,
  model: string | undefined,
  opts: RunOptions = {},
  skillOpts: SkillRunOptions = {},
): Promise<ChatResult> {
  // 1. Resolve model
  const resolvedModel = resolveSkillModel(skill, provider, model);

  // 2. Build enriched input (add output structure hint)
  const outputHint = buildOutputHint(skill);
  const enrichedInput = outputHint ? input + outputHint : input;

  // 3. Build system prompt with skill context
  const skillSystemPrompt = buildSystemPromptWithSkill(
    skill,
    skillOpts.baseSystemPrompt,
  );

  // 4. Dispatch
  let result: ChatResult;

  if (skillOpts.baseHandler) {
    // Route through the provided handler (e.g. handleChat, handleSearch)
    // The handler doesn't receive a custom systemPrompt param — so we
    // inject via a wrapper that calls provider.chat() directly for chat intents.
    result = await skillOpts.baseHandler(
      provider,
      enrichedInput,
      resolvedModel,
      opts,
    );
  } else {
    // Fallback: direct chat with skill system prompt
    const messages = [{ role: "user" as const, content: enrichedInput }];
    result = await provider.chat(messages, {
      systemPrompt: skillSystemPrompt,
      model: resolvedModel,
      maxTokens: skill.meta.model?.maxTokens,
      temperature: skill.meta.model?.temperature,
      signal: opts.signal,
    });
  }

  // 5. Apply constraints / post-processing
  const finalText = applyConstraints(result.text, skill);

  // 6. Mark activated (cooldown tracking)
  markActivated(skill.meta.name);

  return { ...result, text: finalText };
}

// ── Confirmation flow ─────────────────────────────────────────────────────────

/**
 * Returns true if the skill requires user confirmation before running.
 * The caller (useAgent.ts) should display a prompt and await "y/n".
 */
export function skillNeedsConfirmation(skill: LoadedSkill): boolean {
  return skill.meta.gate?.requiresConfirmation === true;
}

/**
 * Build the confirmation message shown to the user before running a skill.
 */
export function buildConfirmationPrompt(
  skill: LoadedSkill,
  input: string,
): string {
  return [
    `🔧 Skill: **${skill.meta.name}**`,
    skill.meta.description ? `   ${skill.meta.description}` : "",
    `   Input: "${input.slice(0, 80)}${input.length > 80 ? "…" : ""}"`,
    "",
    "   Proceed? [y/N]",
  ]
    .filter(Boolean)
    .join("\n");
}
