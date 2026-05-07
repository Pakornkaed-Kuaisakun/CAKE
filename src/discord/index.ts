import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { registerCommands } from "./register.js";
import { getDefaultProvider } from "../providers/index.js";
import { CakeAgent } from "../agent/index.js";
import { handleAsk } from "./handlers/ask.js";
import { handleEmails } from "./handlers/email.js";
import { handleNews } from "./handlers/news.js";
import { handleCalendar } from "./handlers/calendar.js";
import { handleTodos, handleAddTodo, handlePlan } from "./handlers/todos.js";
import { handleSearch } from "./handlers/search.js";
import { handleFile } from "./handlers/files.js";
import { env } from "../config/env.js";

// Per-user agent instances (preserves chat history per user)
const agents = new Map<string, CakeAgent>();
function getAgent(userId: string): CakeAgent {
  if (!agents.has(userId))
    agents.set(userId, new CakeAgent(getDefaultProvider()));
  return agents.get(userId)!;
}

const HELP_TEXT = [
  "**⚡ CAKE — AI Unified Runtime Assistant**",
  "",
  "`/ask <question>` — Chat with CAKE",
  "`/news` — Summarized news digest",
  "`/emails [count]` — Read & summarize emails",
  "`/calendar [max]` — Upcoming calendar events",
  "`/todos` — List pending tasks",
  "`/addtodo <task>` — Add a task",
  "`/plan <goal>` — AI-generate task plan",
  "`/search <query>` — Web search + AI answer",
  "`/file list|read|summarize <path>` — File ops",
  "`/clear` — Clear your conversation history",
].join("\n");

async function dispatch(
  interaction: ChatInputCommandInteraction,
): Promise<string> {
  const agent = getAgent(interaction.user.id);
  switch (interaction.commandName) {
    case "ask":
      return handleAsk(interaction, agent);
    case "news":
      return handleNews(interaction, agent);
    case "emails":
      return handleEmails(interaction, agent);
    case "calendar":
      return handleCalendar(interaction, agent);
    case "todos":
      return handleTodos(interaction, agent);
    case "addtodo":
      return handleAddTodo(interaction, agent);
    case "plan":
      return handlePlan(interaction, agent);
    case "search":
      return handleSearch(interaction, agent);
    case "file":
      return handleFile(interaction, agent);
    case "clear":
      agent.clearHistory();
      return "✅ History cleared.";
    case "help":
      return HELP_TEXT;
    default:
      return `Unknown command: ${interaction.commandName}`;
  }
}

async function reply(
  interaction: ChatInputCommandInteraction,
  text: string,
): Promise<void> {
  const chunks = text.match(/.{1,1900}/gs) ?? ["(empty)"];
  await interaction.editReply(chunks[0]);
  for (const chunk of chunks.slice(1)) await interaction.followUp(chunk);
}

async function main() {
  await registerCommands();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once("ready", () =>
    console.log(`⚡ CAKE Discord bot ready as ${client.user?.tag}`),
  );
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply();
    try {
      await reply(interaction, await dispatch(interaction));
    } catch (err) {
      await interaction.editReply(
        `[ERROR] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
  await client.login(env.discordToken);
}

main().catch(console.error);
