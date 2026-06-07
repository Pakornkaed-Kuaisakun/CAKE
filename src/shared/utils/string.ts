// Verb-stripping

import { ExecutionState } from "../../agent/autonomous/executionState.js";

/**
 * Remove one of the provided verb prefixes from raw user input.
 *
 * @example
 *   stripVerb("locker_add my-key", ["locker_add", "locker add"]) → "my-key"
 */

export function stripVerb(input: string, verbs: string[]): string {
  for (const v of verbs) {
    const re = new RegExp(`^${v}\s*`, "i");
    if (re.test(input)) {
      return input.replace(re, "").trim();
    }
  }
  return input.trim();
}

/**
 * Ensure the raw input begins with a command prefix.
 * Used by toolRegistry.ts to normalise tool inputs before dispatch.
 *
 * @example
 *   ensureCommandPrefix("abc-123", "async_status") → "async_status abc-123"
 */

export function ensureCommandPrefix(input: string, command: string): string {
  const trimmed = input.trim();
  if (!trimmed) return command;
  return trimmed.toLocaleLowerCase().startsWith(`${command.toLowerCase()} `)
    ? trimmed
    : `${command} ${trimmed}`;
}

// ── Collection / payload parsing ───────────────────────────────────────────────

/**
 * Split a string at the first whitespace into a collection name and payload.
 * Collection names cannot contain spaces; the rest is the payload.
 *
 * @example
 *   splitCollectionPayload("diseases What causes malaria?")
 *   → { collection: "diseases", payload: "What causes malaria?" }
 */

export function splitCollectionPayload(s: string): {
  collection: string;
  payload: string;
} {
  const idx = s.search(/\s/);
  if (idx === -1) return { collection: s.trim(), payload: "" };
  return {
    collection: s.slice(0, idx).trim(),
    payload: s.slice(idx + 1).trim(),
  };
}

// ── Truncation / preview ───────────────────────────────────────────────────────

/**
 * Shorten a string to `max` characters, appending "…" if truncated.
 */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

/**
 * Collapse all whitespace sequences to a single space and trim.
 */

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ── Placeholder resolution ─────────────────────────────────────────────────────

/**
 * Replace `{{step:N.output}}` placeholders in `input` with actual step output
 * from a completed-steps list.
 *
 * Extracted from autonomous/executor.ts so it can be unit-tested in isolation.
 */
export function resolvePlaceholders(
  input: string,
  completedSteps: Array<{
    step: number;
    fullOutput?: string;
    outputSummary: string;
  }>,
): string {
  return input.replace(/\{\{step:(\d+)\.output\}\}/gi, (match, stepNum) => {
    const num = Number(stepNum);
    const step = completedSteps?.find((s) => s.step === num);
    return step?.fullOutput ?? step?.outputSummary ?? match;
  });
}

// ── Goal / filename helpers ────────────────────────────────────────────────────

/**
 * Convert a free-text goal string to a filesystem-safe slug.
 *
 * @example
 *   slugifyGoal("Research AI trends 2025!") → "research_ai_trends_2025"
 */
export function slugifyGoal(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "autonomous_report";
}

export function stripThinking(text: string): string {
  if (!text) return text;

  // Remove <think>...</think> blocks (may span multiple lines, may be unclosed at EOF)
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "") // unclosed block (stream cut off)
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thinking>[\s\S]*/gi, "") // unclosed block
    .trimStart(); // remove leading whitespace left behind
}

export function stripQuotes(s: string): string {
  if (!s) return s;
  return s.replace(/^["'`]|["'`]$/g, "").trim();
}

export function parseJsonMarkdown(text: string): any {
  if (!text) return null;
  let cleaned = text.replace(/```json|```/g, "").trim();
  cleaned = cleaned.replace(/\/\/.*/gm, ""); // strip comments
  return JSON.parse(cleaned);
}
