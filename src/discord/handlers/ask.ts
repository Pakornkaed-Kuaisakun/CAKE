import type { ChatInputCommandInteraction } from "discord.js";
import type { CakeAgent } from "../../agent/index.js";

export async function handleAsk(
  interaction: ChatInputCommandInteraction,
  agent: CakeAgent,
): Promise<string> {
  const question = interaction.options.getString("question", true);
  const result = await agent.run(question);
  return result.text;
}
