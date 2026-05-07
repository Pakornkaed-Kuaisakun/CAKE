import type { ChatInputCommandInteraction } from "discord.js";
import type { CakeAgent } from "../../agent/index.js";

export async function handleTodos(
  _interaction: ChatInputCommandInteraction,
  agent: CakeAgent,
): Promise<string> {
  const result = await agent.run("show my todo list");
  return result.text;
}

export async function handleAddTodo(
  interaction: ChatInputCommandInteraction,
  agent: CakeAgent,
): Promise<string> {
  const task = interaction.options.getString("task", true);
  const result = await agent.run(`add todo ${task}`);
  return result.text;
}

export async function handlePlan(
  interaction: ChatInputCommandInteraction,
  agent: CakeAgent,
): Promise<string> {
  const goal = interaction.options.getString("goal", true);
  const result = await agent.run(`plan goal ${goal}`);
  return result.text;
}
