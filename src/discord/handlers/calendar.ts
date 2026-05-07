import type { ChatInputCommandInteraction } from "discord.js";
import type { CakeAgent } from "../../agent/index.js";

export async function handleCalendar(
  interaction: ChatInputCommandInteraction,
  agent: CakeAgent,
): Promise<string> {
  const max = interaction.options.getInteger("max") ?? 10;
  const result = await agent.run(`show my calendar events max ${max}`);
  return result.text;
}
