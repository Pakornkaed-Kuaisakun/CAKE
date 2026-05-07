import type { ChatInputCommandInteraction } from "discord.js";
import type { CakeAgent } from "../../agent/index.js";

export async function handleEmails(
  interaction: ChatInputCommandInteraction,
  agent: CakeAgent,
): Promise<string> {
  const count = interaction.options.getInteger("count") ?? 5;
  const result = await agent.run(`read my ${count} emails`);
  return result.text;
}
