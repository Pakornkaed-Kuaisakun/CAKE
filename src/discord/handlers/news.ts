import type { ChatInputCommandInteraction } from "discord.js";
import type { CakeAgent } from "../../agent/index.js";

export async function handleNews(
  _interaction: ChatInputCommandInteraction,
  agent: CakeAgent,
): Promise<string> {
  const result = await agent.run("latest news");
  return result.text;
}
