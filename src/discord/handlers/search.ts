import type { ChatInputCommandInteraction } from "discord.js";
import type { CakeAgent } from "../../agent/index.js";

export async function handleSearch(
  interaction: ChatInputCommandInteraction,
  agent: CakeAgent,
): Promise<string> {
  const query = interaction.options.getString("query", true);
  const result = await agent.run(`search ${query}`);
  return result.text;
}
