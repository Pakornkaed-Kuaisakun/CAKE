// src/agent/promptAssembler.ts
import { SYSTEM_PROMPT, HALLUCINATION_PREVENTION } from "../config/constants.js";

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
}

export const STATIC_CORE_PROMPT = (
  SYSTEM_PROMPT + "\n\n" + HALLUCINATION_PREVENTION
).trim();

// This is rebuilt only when profile.summary changes (every N signals)
export function buildProfileLayer(profileSummary: string): string {
  if (!profileSummary) return "";
  return `\n\n[User context from past interactions]\n${profileSummary}`;
}

// This is built per-request from memory retrieval
export function buildRetrievedContextLayer(memories: string[]): string {
  if (memories.length === 0) return "";
  return `\n\nRelevant context:\n${memories.map((m) => `- ${m.slice(0, 150)}`).join("\n")}`;
}

export function assembleSystemPrompt(layers: PromptLayers): string {
  return layers.staticCore + layers.profileSnapshot + layers.retrievedContext;
}
