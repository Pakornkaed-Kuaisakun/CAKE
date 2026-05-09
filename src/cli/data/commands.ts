export interface CommandSuggestion {
  command: string;
  description: string;
}

export const COMMANDS: CommandSuggestion[] = [
  // ── Core commands ───────────────────────────────────────────────────────────
  {
    command: "email",
    description: "Read and summarize emails from inbox (top 5)",
  },
  { command: "news", description: "Fetch top 5 news from each RSS feed" },
  { command: "calendar_list", description: "List upcoming events" },
  {
    command: "calendar_create <events>",
    description: "Create calendar events",
  },
  {
    command: "calendar_remove <id>",
    description: "Remove a calendar event by ID",
  },
  { command: "todo_list", description: "List current todo tasks" },
  { command: "todo_add <task>", description: "Add new todo task" },
  { command: "plan <tasks>", description: "Create a plan for the day" },
  { command: "cron_list", description: "List all scheduled tasks" },
  { command: "cron_schedule <task>", description: "Schedule a new task" },
  { command: "cron_remove <id>", description: "Remove a scheduled task" },
  {
    command: "finance <stock_tickers>",
    description: "Get stock analysis report PDF",
  },
  { command: "document_read <path>", description: "Read a document" },
  { command: "document_summarize <path>", description: "Summarize a document" },
  {
    command: "document_ask <path>",
    description: "Ask a question about a document",
  },
  { command: "file_list <path>", description: "List all files in a directory" },
  { command: "directory_tree <path>", description: "Get the directory tree" },
  { command: "file_read <path>", description: "Read a file" },
  { command: "file_summarize <path>", description: "Summarize a file" },
  { command: "file_compose <path>", description: "Compose a file" },
  { command: "search <query>", description: "Search the web for information" },
  {
    command: "memory_index <path>",
    description: "Index a document for memory",
  },
  { command: "notify <message>", description: "Send a notification" },
  { command: "test_notify", description: "Send a test notification" },
  { command: "diagnosis system", description: "Diagnose system" },
  { command: "performance check", description: "Performance check" },
  {
    command: "weather",
    description: "Get weather report (from IP geolocation)",
  },

  // ── Export sink (standalone) ────────────────────────────────────────────────
  {
    command: "export txt <filename>",
    description: "Export last result to a .txt file",
  },
  {
    command: "export md <filename>",
    description: "Export last result to a .md file",
  },
  {
    command: "export json <filename>",
    description: "Export last result to a .json file",
  },
  {
    command: "export csv <filename>",
    description: "Export last result to a .csv file",
  },
  {
    command: "export html <filename>",
    description: "Export last result to a .html file",
  },

  // ── Pipeline examples ───────────────────────────────────────────────────────
  {
    command: "directory_tree . | export txt tree.txt",
    description: "Save directory tree to a text file",
  },
  {
    command: "directory_tree . | export md structure.md",
    description: "Save directory tree as Markdown",
  },
  {
    command: "email | export md emails.md",
    description: "Save email digest to Markdown",
  },
  {
    command: "news | export txt news.txt",
    description: "Save news digest to a text file",
  },
  {
    command: "todo_list | export md todos.md",
    description: "Export your todo list to Markdown",
  },
  {
    command: "calendar_list | export txt schedule.txt",
    description: "Export upcoming events to a text file",
  },
  {
    command: "weather | export txt weather.txt",
    description: "Save today's weather report to a file",
  },
  {
    command: "document_summarize <path> | export md summary.md",
    description: "Summarize a document and save as Markdown",
  },
  {
    command: "file_summarize <path> | export txt summary.txt",
    description: "Summarize a file and save to text",
  },
  {
    command: "search <query> | export md results.md",
    description: "Search and save results to Markdown",
  },
  {
    command: "cron_list | export json cron-jobs.json",
    description: "Export cron jobs to JSON",
  },

  // ── Slash commands ──────────────────────────────────────────────────────────
  { command: "/help", description: "Show this help message" },
  { command: "/exit", description: "Exit the CLI" },
  { command: "/clear", description: "Clear the screen" },
  {
    command: "/provider <name>",
    description:
      "Switch to a different LLM provider (claude/openai/gemini/ollama)",
  },
  { command: "/model <name>", description: "Switch to a different model" },
  { command: "/prefs", description: "Show current session & default settings" },
  {
    command: "/default [--save]",
    description: "Save current session as your default",
  },
  { command: "/default --reset", description: "Clear all saved defaults" },
  { command: "/calendar auth", description: "Re-authenticate Google Calendar" },
  {
    command: "/auth-status",
    description: "Show authentication status for all services",
  },
];
