import type { ChatInputCommandInteraction } from "discord.js";
import type { CakeAgent } from "../../agent/index.js";

export async function handleFile(
  interaction: ChatInputCommandInteraction,
  agent: CakeAgent,
): Promise<string> {
  const sub = interaction.options.getSubcommand();
  const filePath = interaction.options.getString("path", true);
  const result = await agent.run(`${sub} file ${filePath}`);
  return result.text;
}
