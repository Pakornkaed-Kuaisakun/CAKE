// src/agent/promptAssembler.ts
import { SYSTEM_PROMPT, RESPONSE_BREVITY_GUIDANCE, HALLUCINATION_PREVENTION } from "../config/constants.js";
import {
  getIntentSpecificGuardrail,
} from "../modules/hallucination/promptGuards.js";

export interface PromptLayers {
  /**
   * LAYER 1: Completely static. Never changes.
   * Perfect candidate for Claude prompt caching.
   * Contains: persona, tool descriptions, rules.
   */
  staticCore: string;

  /**
   * LAYER 2: Changes only when user profile reaches a new checkpoint.
   * Regenerated every ~5 new signals, not every turn.
   * Contains: distilled user profile summary.
   */
  profileSnapshot: string;

  /**
   * LAYER 3: Per-request dynamic context.
   * Retrieved from memory, relevant to this specific query.
   * Small (3-5 bullet points max).
   */
  retrievedContext: string;

  /**
   * LAYER 4 (optional): Intent-specific hallucination guardrail.
   * Injected when a high-risk intent is detected (finance, search, etc.).
   * Kept separate from the static core so cache hits are preserved for
   * the base layers.
   */
  intentGuardrail?: string;
}

export const STATIC_CORE_PROMPT = (
  SYSTEM_PROMPT + "\n\n" + RESPONSE_BREVITY_GUIDANCE + "\n\n" + HALLUCINATION_PREVENTION
).trim();

// This is rebuilt only when profile.summary changes (every N signals)
export function buildProfileLayer(profileSummary: string): string {
  if (!profileSummary) return "";
  return `\n\n[User context from past interactions]\n${profileSummary}`;
}

// This is built per-request from memory retrieval
export function buildRetrievedContextLayer(memories: string[]): string {
  if (memories.length === 0) return "";
  const items = memories.slice(0, 2);
  return `\n\nRelevant context (use only if needed):\n${items.map((m) => `- ${m.slice(0, 100)}`).join("\n")}`;
}

/**
 * Build an intent-specific guardrail layer.
 * Returns empty string for low-risk intents (chat, todo_list, etc.)
 * so the cache hit rate on the base system prompt is not affected.
 */
export function buildIntentGuardrailLayer(intent: string): string {
  const guardrail = getIntentSpecificGuardrail(intent);
  if (!guardrail) return "";
  return `\n\n${guardrail}`;
}

export function assembleSystemPrompt(layers: PromptLayers): string {
  return (
    layers.staticCore +
    layers.profileSnapshot +
    layers.retrievedContext +
    (layers.intentGuardrail ?? "")
  );
}