export interface CommandSuggestion {
  command: string;
  description: string;
}

export const COMMANDS: CommandSuggestion[] = [
  {
    command: "email",

    description: "Read and summarize emails from inbox (top 5)",
  },

  {
    command: "news",

    description: "Fetch top 5 news from each RSS feed",
  },

  {
    command: "calendar_list",

    description: "List upcoming events",
  },

  {
    command: "calendar_create <events>",

    description: "Create calendar events",
  },

  {
    command: "calendar_remove <id>",

    description: "Remove a calendar event by ID",
  },

  {
    command: "todo_list",

    description: "List current todo tasks",
  },

  {
    command: "todo_add <task>",

    description: "Add new todo task",
  },

  {
    command: "plan <tasks>",

    description: "Create a plan for the day",
  },

  {
    command: "cron_list",

    description: "List all scheduled tasks",
  },

  {
    command: "cron_schedule <task>",

    description: "Schedule a new task",
  },

  {
    command: "cron_remove <id>",

    description: "Remove a scheduled task",
  },

  {
    command: "finance <stock_tickers>",

    description: "Get stock analysis report PDF",
  },

  {
    command: "document_read <path>",

    description: "Read a document",
  },

  {
    command: "document_summarize <path>",

    description: "Summarize a document",
  },

  {
    command: "document_ask <path>",

    description: "Ask a question about a document",
  },

  {
    command: "file_list <path>",

    description: "List all files in the current directory",
  },

  {
    command: "directory_tree <path>",

    description: "Get the directory tree",
  },

  {
    command: "file_read <path>",

    description: "Read a file",
  },

  {
    command: "file_summarize <path>",

    description: "Summarize a file",
  },

  {
    command: "file_compose <path>",

    description: "Compose a file",
  },

  {
    command: "search <query>",

    description: "Search the web for information",
  },

  {
    command: "memory_index <path>",

    description: "Index a document for memory",
  },

  {
    command: "notify <message>",

    description: "Send a notification",
  },

  {
    command: "test_notify",

    description: "Send a test notification",
  },

  {
    command: "diagnosis system",

    description: "Diagnose system",
  },
  {
    command: "performance check",

    description: "Performance check",
  },

  //   {
  //     command: "email <to> <subject> <body_path>",

  //     description: "Send an email",
  //   },

  // Slash commands
  {
    command: "/help",

    description: "Show this help message",
  },

  {
    command: "/exit",

    description: "Exit the CLI",
  },

  {
    command: "/clear",

    description: "Clear the screen",
  },

  {
    command: "/provider <name>",

    description:
      "Switch to a different LLM provider (claude/openai/gemini/ollama)",
  },

  {
    command: "/model <name>",

    description: "Switch to a different model ",
  },
  {
    command: "/prefs",

    description: "Show current session & default settings",
  },
  {
    command: "/default [--save]",

    description: "Save current session as your default",
  },

  {
    command: "/default --reset",
    description: "Clear all saved defaults",
  },

  {
    command: "/calendar auth",
    description: "Re-authenticate Google Calendar",
  },

  {
    command: "/auth-status",
    description: "Show authentication status for all services",
  },
];
