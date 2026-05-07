import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "../config/env.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask CAKE anything")
    .addStringOption((o) =>
      o.setName("question").setDescription("Your question").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("news")
    .setDescription("Summarized news digest"),

  new SlashCommandBuilder()
    .setName("emails")
    .setDescription("Read and summarize your latest emails")
    .addIntegerOption((o) =>
      o
        .setName("count")
        .setDescription("Number of emails (default 5)")
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("calendar")
    .setDescription("Show upcoming calendar events")
    .addIntegerOption((o) =>
      o.setName("max").setDescription("Max events").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("todos")
    .setDescription("List your pending tasks"),

  new SlashCommandBuilder()
    .setName("addtodo")
    .setDescription("Add a new task")
    .addStringOption((o) =>
      o.setName("task").setDescription("Task title").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("plan")
    .setDescription("Generate an AI task plan for a goal")
    .addStringOption((o) =>
      o.setName("goal").setDescription("Your goal").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Web search + AI answer")
    .addStringOption((o) =>
      o.setName("query").setDescription("Search query").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("file")
    .setDescription("File operations")
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("List directory")
        .addStringOption((o) =>
          o.setName("path").setDescription("Path").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("read")
        .setDescription("Read a file")
        .addStringOption((o) =>
          o.setName("path").setDescription("Path").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("summarize")
        .setDescription("AI summarize a file")
        .addStringOption((o) =>
          o.setName("path").setDescription("Path").setRequired(true),
        ),
    ),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear your conversation history"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show available commands"),
].map((c) => c.toJSON());

export async function registerCommands(): Promise<void> {
  const rest = new REST().setToken(env.discordToken);
  const route = env.discordGuildId
    ? Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId)
    : Routes.applicationCommands(env.discordClientId);

  await rest.put(route, { body: commandDefinitions });
  console.log("✅ Slash commands registered");
}
