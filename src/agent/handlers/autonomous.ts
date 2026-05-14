import type { AIProvider, ChatResult } from "../../providers/types.js";
import { executeAutonomous } from "../autonomous/index.js";
import { AGENT_TOOLS } from "../autonomous/toolRegistry.js";
import { text } from "../utils/text.js";

/**
 * Strips the trigger prefix from the user input to extract the bare goal.
 * Handles:
 *   "auto <goal>"
 *   "agent <goal>"
 *   "autonomous <goal>"
 *   "run agent <goal>"
 *   "run auto <goal>"
 */

function extractGoal(input: string): string {
  return input.replace(/^(run\s+)?(auto|agent|autonomous)\s+/i, "").trim();
}

export async function handleAutonomous(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const goal = extractGoal(input);

  if (!goal) {
    const toolNames = AGENT_TOOLS.map(
      (t) => `  • ${t.name} — ${t.description}`,
    ).join("\n");
    return text(
      `[AGENT] Usage: auto <goal>\n\nExample:\n  auto Research the top 3 Node.js HTTP frameworks and save a comparison to md\n\nAvailable tools:\n${toolNames}`,
    );
  }

  const header = `[AGENT] Goal: ${goal}\n${"─".repeat(50)}\n`;
  const stepLines: string[] = [];

  const result = await executeAutonomous(provider, goal, {
    maxSteps: 10,
    model,
    onStep: (step) => {
      const icon = step.tool === "finish" ? "✅" : step.success ? "🔧" : "⚠️";
      const line = [
        `${icon} Step ${step.step}: [${step.tool}]`,
        `   💭 ${step.thought}`,
        `   ▶  ${step.input.slice(0, 120)}${step.input.length > 120 ? "…" : ""}`,
      ].join("\n");
      stepLines.push(line);
    },
  });

  const body = [
    header,
    stepLines.join("\n\n"),
    "",
    "─".repeat(50),
    result.success
      ? `✅ Done in ${result.stepsUsed} step${result.stepsUsed !== 1 ? "s" : ""}.\n\n${result.finalAnswer}`
      : `⚠️  Stopped after ${result.stepsUsed} steps.\n\n${result.finalAnswer}`,
  ].join("\n");

  return text(body);
}
