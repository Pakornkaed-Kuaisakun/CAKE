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
    2. The JSON must have exactly three fields:
      { "thought": "<reasoning>", "tool": "<tool name>", "input": "<exact string to pass>" }
    3. Pick the most direct tool. Prefer fewer steps over more steps.
    4. To SAVE content to a file:
      a. First use "chat" to COMPOSE the full text content.
      b. Then use "export" with input "<format> <filename>|<content>" to save it.
      IMPORTANT: The "|" separates the filename from the content. Examples:
        export md report.md|# My Report\n\nContent goes here...
        export txt notes.txt|Line 1\nLine 2
    5. Do NOT use "file_compose" to save a report — that tool generates from a description only.
    6. When you have accomplished the goal, use "finish" with a brief summary as input.
    7. Do NOT repeat a tool call with the exact same input twice.
    8. If a tool returned an error, try a different approach.
    9. Keep "input" concise but complete — it is passed directly to the tool.`;
}

function buildUserMessage(
  goal: string,
  history: Array<{ tool: string; input: string; output: string }>,
): string {
  let msg = `GOAL: ${goal}\n\n`;

  if (history.length === 0) {
    msg += "This is the first step. Start working towards the goal.";
  } else {
    msg += "STEPS TAKEN SO FAR:\n";
    for (const h of history) {
      msg += `\nTool: ${h.tool}\nInput: ${h.input.slice(0, 200)}${h.input.length > 200 ? "…" : ""}\nOutput: ${h.output.slice(0, 600)}${h.output.length > 600 ? "…" : ""}\n`;
    }
    msg += "\nWhat should be the NEXT step to complete the goal?";
  }
  return msg;
}

export async function planNextStep(
  provider: AIProvider,
  goal: string,
  history: Array<{ tool: string; input: string; output: string }>,
  model?: string,
): Promise<ThoughtStep> {
  const fastModel = model || getFastModel(provider.name);

  const result = await provider.chat(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserMessage(goal, history) },
    ],
    { model: fastModel, temperature: 0.2, maxTokens: 1000 },
  );

  const step = extractThoughtStep(result.text);
  if (step) return step;

  // ── Retry: ask the model to output ONLY valid JSON ─────────────────────────
  // Some models wrap the JSON in prose on the first attempt. One retry with a
  // blunter prompt usually fixes it.
  const retry = await provider.chat(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserMessage(goal, history) },
      { role: "assistant", content: result.text },
      {
        role: "user",
        content:
          'Your response was not valid JSON. Output ONLY the raw JSON object with fields "thought", "tool", and "input". No explanation, no markdown, no code fences.',
      },
    ],
    { model: fastModel, temperature: 0, maxTokens: 600 },
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
 */
function extractThoughtStep(raw: string): ThoughtStep | null {
  // 1. Strip markdown fences and whitespace
  let text = raw.replace(/```(?:json)?/gi, "").trim();

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

