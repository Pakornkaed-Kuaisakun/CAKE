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
    { model: fastModel, temperature: 0.2, maxTokens: 800 },
  );

  const raw = result.text.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(raw) as ThoughtStep;
    if (!parsed.thought || !parsed.tool || parsed.input === undefined) {
      throw new Error("Missing required fields");
    }
    return parsed;
  } catch {
    return {
      thought: "Could not parse planner output — finishing with raw response.",
      tool: "finish",
      input: result.text.trim(),
    };
  }
}
