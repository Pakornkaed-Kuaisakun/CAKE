// src/agent/autonomous/planner.ts
import type { AIProvider } from "../../providers/types.js";
import type { ThoughtStep } from "./types.js";
import { AGENT_TOOLS } from "./toolRegistry.js";
import { getFastModel } from "../../providers/utils.js";

function buildSystemPrompt(): string {
  const toolList = AGENT_TOOLS.map(
    (t) => `  - ${t.name}: ${t.description}\n    example input: "${t.example}"`,
  ).join("\n");

  return `You are an autonomous AI agent. Accomplish the GOAL step-by-step using the tools below.

    AVAILABLE TOOLS:
    ${toolList}

    RULES:
    1. Output ONLY a JSON object — no extra text, no markdown fences.
    2. The JSON must have exactly three fields (IMPORTANT):
      { "thought": "<reasoning>", "tool": "<tool name>", "input": "<exact string to pass>" }
    3. Pick the most direct tool. Prefer fewer steps over more steps.
    4. To SAVE content to a file, use the "export" tool:
       Format: export <format> <filename>|<full content here>
       The "|" character separates the filename from the content body.
       The content body MUST be the complete text to write — do NOT truncate it.
       Examples:
         export md report.md|# My Report\n\nContent goes here...
         export txt notes.txt|Line 1\nLine 2
       IMPORTANT: Put ALL content after the "|" — never split across multiple steps.
    5. When you need to write a report:
       a. Use "chat" to compose the FULL report content (do not truncate).
       b. Then use "export" with the full content inline after "|".
    6. Do NOT use "file_compose" to save a report — that tool generates from a description only.
    7. When you have accomplished the goal, use "finish" with a brief summary as input.
    8. Do NOT repeat a tool call with the exact same input twice.
    9. If a tool returned an error, try a different approach.
    10. Keep "input" concise but complete — it is passed directly to the tool.
    11. Never truncate content mid-sentence. If content is long, include it all.`;
}

export async function planNextStep(
  provider: AIProvider,
  plannerMessage: string,
  model?: string,
): Promise<ThoughtStep> {
  const fastModel = model || getFastModel(provider.name);

  const result = await provider.chat(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: plannerMessage },
    ],
    {
      model: fastModel,
      temperature: 0.2,
      // BUG FIX: was 1000 — too small for export steps that include full report
      // content inline after the "|" separator. Raised to 4000 so the planner
      // can emit a complete export instruction without truncating the body.
      maxTokens: 4000,
    },
  );

  const step = extractThoughtStep(result.text);
  if (step) return step;

  // ── Retry: ask the model to output ONLY valid JSON ─────────────────────────
  // Some models wrap the JSON in prose on the first attempt. One retry with a
  // blunter prompt usually fixes it.
  const retry = await provider.chat(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: plannerMessage },
      { role: "assistant", content: result.text },
      {
        role: "user",
        content:
          'Your response was not valid JSON. Output ONLY the raw JSON object — no <think> tags, no <thinking> tags, no markdown, no prose, no code fences. ' +
          'Example: {"thought":"...","tool":"...","input":"..."}',
      },
    ],
    {
      model: fastModel,
      temperature: 0,
      // Also raise the retry limit so the content is not cut short
      maxTokens: 4000,
    },
  );

  const retryStep = extractThoughtStep(retry.text);
  if (retryStep) return retryStep;

  // ── Hard fallback ──────────────────────────────────────────────────────────
  return {
    thought: "Could not parse planner output after retry — finishing.",
    tool: "finish",
    input: retry.text.trim() || result.text.trim(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Attempts to extract a valid ThoughtStep JSON object from raw model text.
 * Handles:
 *   - Clean JSON: `{"thought":...}`
 *   - Markdown-fenced: ```json\n{...}\n```
 *   - Prose-wrapped: "Here is my step:\n{...}"
 *   - Single-quoted keys (some small models)
 *
 * IMPORTANT: The "input" field may contain a long export body (content after "|").
 * We must NOT truncate it during parsing.
 */
function extractThoughtStep(raw: string): ThoughtStep | null {
  // 1. Strip thinking-model reasoning blocks, then markdown fences.
  //    Reasoning models (Claude Thinking, DeepSeek-R1, Gemini Thinking) emit
  //    <think>...</think> or <thinking>...</thinking> before the JSON object.
  //    Without this strip the greedy {[\s\S]*} regex matches a '{' inside the
  //    prose, JSON.parse fails, and the hard fallback fires "finish" with no
  //    export ever running.
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();

  // 2. Try direct parse first
  const direct = tryParse(text);
  if (direct) return direct;

  // 3. Find the first {...} block that spans the most of the text
  //    Handles prose before/after the JSON.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    const block = tryParse(match[0]);
    if (block) return block;
  }

  return null;
}

function tryParse(text: string): ThoughtStep | null {
  const validate = (obj: any): ThoughtStep | null => {
    if (
      typeof obj === "object" &&
      obj !== null &&
      typeof obj.thought === "string" &&
      typeof obj.tool === "string" &&
      obj.input !== undefined
    ) {
      return {
        thought: obj.thought,
        tool: String(obj.tool).trim().toLowerCase(),
        // Convert to string but preserve full length — do NOT slice here
        input: String(obj.input ?? ""),
      };
    }
    return null;
  };

  try {
    // Attempt 1: Standard JSON parse
    return validate(JSON.parse(text));
  } catch {
    try {
      // Attempt 2: Sanitize unescaped newlines inside double-quoted strings
      // Smaller models (like Llama 3) often output raw newlines instead of \n
      const sanitized = text.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m, p1) => {
        return '"' + p1.replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
      });
      return validate(JSON.parse(sanitized));
    } catch {
      // Attempt 3: Very aggressive - handle single quotes (some tiny models do this)
      try {
        const doubleQuoted = text.replace(/'/g, '"');
        return validate(JSON.parse(doubleQuoted));
      } catch {
        return null;
      }
    }
  }
}
