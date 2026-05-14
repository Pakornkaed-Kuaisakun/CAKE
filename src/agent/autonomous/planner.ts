import type { AIProvider } from "../../providers/types.js";
import type { ThoughtStep } from "./types.js";
import { AGENT_TOOLS } from "./toolRegistry.js";
import { getFastModel } from "../../providers/utils.js";

function buildSystemPrompt(): string {
  const toolList = AGENT_TOOLS.map(
    (t) => `  - ${t.name}: ${t.description}\n    example: "${t.example}"`,
  ).join("\n");

  return `You are an autonomous AI agent. You are given a GOAL and must accomplish it step-by-step using the available tools.
 
    AVAILABLE TOOLS:
    ${toolList}
    
    RULES:
    1. On each turn, output ONLY a JSON object — no extra text, no markdown fences.
    2. The JSON must have exactly three fields:
    {
        "thought": "<your reasoning about what to do next>",
        "tool": "<tool name from the list>",
        "input": "<the exact string to pass to the tool>"
    }
    3. Always pick the most direct tool for the job.
    4. When you have enough information to fully answer the goal, use "finish" as the tool and write the complete final answer in "input".
    5. Do NOT repeat a tool call with the exact same input twice.
    6. Keep "input" concise — it is passed directly to the tool.
    7. If a previous tool returned an error, try a different approach or tool.`;
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
      msg += `\nTool: ${h.tool}\nInput: ${h.input}\nOutput: ${h.output.slice(0, 800)}${h.output.length > 800 ? "…" : ""}\n`;
    }
    msg += "\nWhat should be the next step?";
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
    { model: fastModel, temperature: 0.2, maxTokens: 600 },
  );

  const raw = result.text.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(raw) as ThoughtStep;
    if (!parsed.thought || !parsed.tool || parsed.input === undefined) {
      throw new Error("Missing required fields");
    }
    return parsed;
  } catch {
    // Fallback: treat the whole response as a finish
    return {
      thought: "Could not parse planner output - finishing with raw response.",
      tool: "finish",
      input: result.text.trim(),
    };
  }
}
