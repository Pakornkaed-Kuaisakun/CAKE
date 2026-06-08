export interface CommandSuggestion {
  command: string;
  description: string;
  parameters?: (string | string[])[];
}

export const HALLUCINATION_COMMANDS: CommandSuggestion[] = [
  {
    command: "/hallucination",
    description: "Show hallucination detection stats overview",
  },
  {
    command: "/hallucination stats",
    description: "Show full hallucination stats",
  },
  {
    command: "/hallucination recent [N]",
    description: "Show last N flagged responses (default 5)",
  },
  {
    command: "/hallucination on",
    description: "Enable hallucination detection (default)",
  },
  {
    command: "/hallucination off",
    description: "Disable hallucination detection for this session",
  },
  {
    command: "/hallucination verbose",
    description: "Toggle inline claim annotation on critical responses",
  },
  {
    command: "/hallucination threshold <0.0-1.0>",
    description: "Set detection threshold (0.4 = default, 1.0 = disabled)",
  },
  {
    command: "/hallucination clear",
    description: "Clear the hallucination event log",
  },
  {
    command: "/hallucination info",
    description: "Show hallucination prevention configuration",
  },
];

export const COMMANDS: CommandSuggestion[] = [
  // ── Core commands ───────────────────────────────────────────────────────────
  {
    command: "email",
    description: "Read and summarize emails from inbox (top 5)",
  },
  {
    command:
      "email_send to <email> subject <subject> [body <body>] [attach <path>]",
    description: "Send a new email with optional attachment",
    parameters: [
      [],
      [],
      ["subject"],
      [],
      ["body", "attach"],
      [],
      ["body", "attach"],
    ],
  },
  { command: "news", description: "Fetch top 5 news from each RSS feed" },
  {
    command: "calendar",
    description: "Google Calendar management",
    parameters: ["auth", "list", "create", "remove"],
  },
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
  { command: "todo_remove <id>", description: "Remove a todo task by ID" },
  { command: "todo_remove_all", description: "Remove all todo tasks" },
  { command: "plan <tasks>", description: "Create a plan for the day" },
  { command: "cron_list", description: "List all scheduled tasks" },
  { command: "cron_schedule <task>", description: "Schedule a new task" },
  { command: "cron_remove <id>", description: "Remove a scheduled task" },
  {
    command: "async <task>",
    description: "Run a task asynchronously in the background",
  },
  { command: "async_list", description: "List queued asynchronous tasks" },
  {
    command: "async_status <id>",
    description: "Show the status of a queued async task",
  },
  {
    command: "async_cancel <id>",
    description: "Cancel a pending background task",
  },
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
  {
    command: "file_find <query> [in <path>]",
    description: "Find files by name or fuzzy search",
  },
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
  {
    command: "scan <directory> <WARNING: Beta version>",
    description: "Perform security scan for malware or suspicious patterns",
  },

  // ── Export sink (standalone) ────────────────────────────────────────────────
  {
    command: "export",
    description: "Export last result to a file",
    parameters: ["txt", "md", "json", "csv", "html"],
  },
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
    command: "file_find <query> | export md results.md",
    description: "Find files and save search results to Markdown",
  },
  {
    command: "file_find <query> in <path> | export txt results.txt",
    description: "Search in specific directory and save results",
  },
  {
    command: "search <query> | export md results.md",
    description: "Search and save results to Markdown",
  },
  {
    command: "cron_list | export json cron-jobs.json",
    description: "Export cron jobs to JSON",
  },
  {
    command: "bash <command>",
    description: "Run a shell command and see its output",
  },
  {
    command: "auto <goal>",
    description: "Autonomous agent: plans & executes multi-step tasks",
  },
  {
    command: "agent <goal>",
    description: "Alias for auto — run autonomous agent",
  },
  {
    command: "auto research <topic> and save report to md",
    description: "Research + export pipeline via agent",
  },
  {
    command: "auto check my emails summarize and add todos",
    description: "Multi-tool autonomous workflow",
  },
  {
    command: "plugins",
    description: "List all loaded plugins and their triggers",
  },
  {
    command: "screenshot [question] <BETA>",
    description: "Capture screen and analyze it with AI vision",
  },
  {
    command: "screenshot region <x,y,w,h> [question] <BETA>",
    description: "Capture a screen region and analyze",
  },
  {
    command: "screenshot save <path> [question] <BETA>",
    description: "Capture, save to file, and analyze",
  },
  {
    command: "vision <question> <BETA>",
    description: "Take a screenshot and answer a question about it",
  },
  // ── Vector Database ─────────────────────────────────────────────────────────
  {
    command: "vdb_query <question>",
    description:
      "Search ALL collections in local vector DB and get an AI answer",
  },
  {
    command: "vdb_query <collection> <question>",
    description: "Search a specific collection and get an AI answer",
  },
  {
    command: "vdb_add <collection> <text>",
    description: "Add a text snippet to a local vector DB collection",
  },
  {
    command: "vdb_ingest <collection> <file_path>",
    description:
      "Ingest a PDF/DOCX/TXT file into a vector DB collection (chunked)",
  },
  {
    command: "vdb_create <collection> [description]",
    description: "Create a new empty vector DB collection",
  },
  {
    command: "vdb_list",
    description: "List all local vector DB collections",
  },
  {
    command: "vdb_list <collection>",
    description: "List documents inside a specific collection",
  },
  {
    command: "vdb_delete <collection> <doc_id>",
    description: "Delete a specific document from a collection",
  },
  {
    command: "vdb_drop <collection>",
    description: "Delete an entire vector DB collection and all its data",
  },
  {
    command: "vdb_clear <collection>",
    description: "Remove all documents from a collection (keep collection)",
  },
  {
    command: "vdb_info <collection>",
    description: "Show collection statistics and sample documents",
  },
  // ── Locker ─────────────────────────────────────────────────────────────────
  {
    command: "locker_add <label> [--category <cat>]",
    description: "Store an encrypted secret (API key, password, token)",
  },
  {
    command: "locker_list",
    description: "List all stored secrets (labels only, no values)",
  },
  {
    command: "locker_get <id or label>",
    description: "Reveal a secret — requires password",
  },
  {
    command: "locker_delete <id or label>",
    description: "Delete a stored secret",
  },
  {
    command: "locker_update <id or label>",
    description: "Update a secret's value — requires password",
  },
  {
    command: "locker_clear --confirm",
    description: "⚠️  Wipe ALL stored secrets permanently",
  },
  {
    command: "locker_info",
    description: "Show locker storage info and encryption details",
  },

  // ── MCP ─────────────────────────────────────────────────────────────────────
  { command: "mcp", description: "Show MCP server status overview" },
  { command: "mcp_list", description: "List all registered MCP servers" },
  {
    command: "mcp_add <template>",
    description: "Add server from template (filesystem, memory, github...)",
    parameters: [
      "filesystem",
      "memory",
      "brave_search",
      "github",
      "sequential_thinking",
      "postgres",
      "puppeteer",
      "slack",
    ],
  },
  {
    command: "mcp_add <name> stdio <command> [args...]",
    description: "Add a stdio MCP server",
  },
  { command: "mcp_add <name> sse <url>", description: "Add an SSE MCP server" },
  { command: "mcp_connect <name>", description: "Connect to an MCP server" },
  {
    command: "mcp_disconnect <name>",
    description: "Disconnect from an MCP server",
  },
  {
    command: "mcp_remove <name>",
    description: "Remove an MCP server from registry",
  },
  { command: "mcp_enable <name>", description: "Enable an MCP server" },
  { command: "mcp_disable <name>", description: "Disable an MCP server" },
  { command: "mcp_tools [server]", description: "List available MCP tools" },
  {
    command: "mcp_call <tool> [json-args]",
    description: "Call an MCP tool directly",
  },
  {
    command: "mcp_resources [server]",
    description: "List available MCP resources",
  },
  { command: "mcp_read <uri>", description: "Read an MCP resource by URI" },
  {
    command: "mcp_prompts [server]",
    description: "List available MCP prompts",
  },

  // ── Slash commands ──────────────────────────────────────────────────────────
  { command: "/help", description: "Show this help message" },
  { command: "/exit", description: "Exit the CLI" },
  { command: "/clear", description: "Clear the screen" },
  { command: "/stop", description: "Stop AI thinking immediately" },
  {
    command: "/cost",
    description: "Show total historical token usage and costs",
    parameters: ["--reset"],
  },
  {
    command: "/reboost",
    description: "Re-initialize the agent and clear session",
  },
  {
    command: "/provider <name>",
    description: "Switch to a different LLM provider",
    parameters: ["claude", "openai", "gemini", "ollama", "openrouter", "puter"],
  },
  { command: "/model <name>", description: "Switch to a different model" },
  { command: "/prefs", description: "Show current session & default settings" },
  {
    command: "/default [set <p> [m] | provider <p> | model <m>]",
    description: "Set default provider/model and switch session",
    parameters: ["set", "provider", "model"],
  },
  {
    command: "/default --reset",
    description: "Reset all defaults to system values",
  },
  {
    command: "/theme <name>",
    description: "Switch theme: dark | light | neon | dracula",
    parameters: ["dark", "light", "neon", "dracula"],
  },
  {
    command: "/calendar <action>",
    description: "Google Calendar management",
    parameters: ["auth", "list", "create", "delete"],
  },
  { command: "/calendar auth", description: "Re-authenticate Google Calendar" },
  {
    command: "/auth-status",
    description: "Show authentication status for all services",
  },
  { command: "/plugins", description: "List loaded plugins" },
  { command: "/session list", description: "List all saved sessions" },
  {
    command: "/session save <name>",
    description: "Save current conversation to a named session",
  },
  { command: "/session load <name>", description: "Restore a saved session" },
  { command: "/session delete <name>", description: "Delete a saved session" },
  {
    command: "/session rename <old> <new>",
    description: "Rename a saved session",
  },
  {
    command: "/session info <name>",
    description: "Show session metadata and message preview",
  },
  { command: "/voice on", description: "Enable voice mode (F2 push-to-talk)" },
  { command: "/voice off", description: "Disable voice mode" },
  { command: "/voice status", description: "Show STT/TTS backend info" },
  {
    command: "/mode debug",
    description: "Toggle debug mode to show all raw AI outputs",
  },
  { command: "/permissions", description: "Show permission settings" },
  {
    command: "/permissions <category> <level>",
    description: "Set permission level for a category",
    parameters: [
      [
        "bash",
        "file_write",
        "file_delete",
        "file_edit",
        "export",
        "chat_export",
        "finance",
      ],
      ["deny", "ask", "allow"],
    ],
  },
  { command: "/memory", description: "Show auto-memory status and stats" },
  { command: "/memory recent", description: "Show auto-recorded decisions" },
  { command: "/memory episodes", description: "Show conversation episodes" },
  { command: "/memory facts", description: "Show auto-extracted facts" },
  { command: "/skills", description: "List loaded skills" },
  { command: "/skills info <name>", description: "Show skill details" },
  { command: "/skills reload", description: "Hot-reload skills from disk" },
  {
    command: "/skills match <text>",
    description: "Test which skills activate",
  },
  {
    command: "deep_search <topic> [--export]",
    description:
      "Multi-angle web research with AI synthesis into a full report (can uto-save report to reports/ folder)",
    parameters: [[], ["--export"]],
  },
  {
    command:
      "tq_add <description> [--priority critical|high|medium|low] [--retries N] [--timeout Ns]",
    description: "Add a task to the priority queue",
    parameters: [
      [],
      ["--priority"],
      ["critical", "high", "medium", "low"],
      ["--retries"],
      [],
      ["--timeout"],
    ],
  },
  {
    command: "tq_list [--status pending|running|completed|failed]",
    description: "List tasks in the queue",
    parameters: [["--status"], ["pending", "running", "completed", "failed"]],
  },
  {
    command: "tq_status <id>",
    description: "Show detailed status for a queued task",
  },
  {
    command: "tq_cancel <id>",
    description: "Cancel a pending or running task",
  },
  {
    command: "tq_pause [<id>]",
    description: "Pause a task or the entire queue",
  },
  { command: "tq_resume [<id>]", description: "Resume a paused task or queue" },
  {
    command: "tq_retry <id>",
    description: "Re-enqueue a failed or cancelled task",
  },
  {
    command: "tq_priority <id> [critical|high|medium|low]",
    description: "Change scheduling priority of a pending task",
    parameters: [[], ["critical", "high", "medium", "low"]],
  },
  {
    command: "tq_purge",
    description: "Remove completed/failed/cancelled tasks from registry",
  },
  { command: "tq_stats", description: "Show queue statistics" },
  { command: "tq_drain", description: "Wait for all queued tasks to finish" },
  ...HALLUCINATION_COMMANDS,
  {
    command: "plan_trip <destination> [days] [budget] [interests]",
    description: "plan trip — geocoding, POI, routes, budget, GeoJSON",
  },
];
