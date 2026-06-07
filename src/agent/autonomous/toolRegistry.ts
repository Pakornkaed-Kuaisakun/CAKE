// src/agent/autonomous/toolRegistry.ts
import type { AIProvider } from "../../providers/types.js";
import type { AgentTool } from "./types.js";
import * as H from "../handlers/index.js";

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "search",
    description:
      "Search the web for current information on any topic. | search <query>",
    example: "search latest Node.js LTS version",
  },
  {
    name: "deep_search",
    description:
      "(heavy — use only when necessary) Run an in-depth research workflow: planning, parallel web search, and synthesis. | deep_search <topic> (supports --export)",
    example: "deep_search latest developments in fusion energy --export",
  },
  {
    name: "bash",
    description: "Run a shell command and get its output. | bash <command>",
    example: "bash ls -la src/",
  },
  {
    name: "file_read",
    description: "Read the contents of a file on disk. | file_read <path>",
    example: "file_read src/agent/index.ts",
  },
  {
    name: "file_summarize",
    description: "AI-summarize a file. | file_summarize <path>",
    example: "file_summarize README.md",
  },
  {
    name: "file_compose",
    description: "Compose a file. | file_compose <path>",
    example: "file_compose README.md",
  },
  {
    name: "file_find",
    description: "Find files by name or fuzzy search. | file_find <query>",
    example: "file_find report.pdf",
  },
  {
    name: "file_list",
    description: "List files in a directory. | file_list <path>",
    example: "file_list src",
  },
  {
    name: "directory_tree",
    description:
      "Show the directory structure of a path. | directory_tree <path>",
    example: "directory_tree src",
  },
  {
    name: "todo_add",
    description: "Add a task to the todo list. | todo_add <task>",
    example: "todo_add Review the authentication module",
  },
  {
    name: "todo_list",
    description: "List all pending todo tasks. | todo_list",
    example: "todo_list",
  },
  {
    name: "todo_remove",
    description: "Remove a todo task by ID. | todo_remove <id>",
    example: "todo_remove 12345",
  },
  {
    name: "todo_remove_all",
    description: "Remove all todo tasks. | todo_remove_all",
    example: "todo_remove_all",
  },
  {
    name: "cron_list",
    description: "List all scheduled tasks. | cron_list",
    example: "cron_list",
  },
  {
    name: "cron_schedule",
    description: "Schedule a new task. | cron_schedule <task>",
    example: "cron_schedule Send a summary email at 5pm",
  },
  {
    name: "cron_remove",
    description: "Remove a scheduled task. | cron_remove <id>",
    example: "cron_remove 12345",
  },
  {
    name: "calendar_list",
    description: "List upcoming calendar events. | calendar_list",
    example: "calendar_list",
  },
  {
    name: "calendar_create",
    description: "Create a new calendar event. | calendar_create <event>",
    example: "calendar_create Meeting with John at 3pm tomorrow",
  },
  {
    name: "calendar_remove",
    description: "Remove a calendar event by ID. | calendar_remove <id>",
    example: "calendar_remove 12345",
  },
  {
    name: "weather",
    description: "Get the current weather report. | weather",
    example: "weather",
  },
  {
    name: "news",
    description:
      "Fetch and summarize recent news, optionally filtered by topic. | news <topic>",
    example: "news AI",
  },
  {
    name: "async",
    description:
      "Queue a background task to run asynchronously. Returns a task id. | async <task_description>",
    example: "async Summarize today's news and save to reports/news.txt",
  },
  {
    name: "async_list",
    description: "List background tasks and their status. | async_list",
    example: "async_list",
  },
  {
    name: "async_status",
    description:
      "Show status and recent output for a background task. | async_status <id>",
    example: "async_status 3f8a9f...",
  },
  {
    name: "async_cancel",
    description: "Cancel a pending background task. | async_cancel <id>",
    example: "async_cancel 3f8a9f...",
  },
  {
    name: "notify",
    description:
      "Send a desktop notification with a message. | notify <message>",
    example: "notify Task complete!",
  },
  {
    name: "document_read",
    description: "Read a document (PDF, DOCX, TXT). | document_read <path>",
    example: "document_read report.pdf",
  },
  {
    name: "document_summarize",
    description:
      "Summarize a PDF, DOCX, or TXT document. | document_summarize <path>",
    example: "document_summarize report.pdf",
  },
  {
    name: "document_ask",
    description:
      "Ask a question about a document. | document_ask <path> <question>",
    example: "document_ask report.pdf What is the main finding?",
  },
  {
    name: "export",
    description:
      "Save text content to a file in the 'reports/' folder. Format: export <format> <filename>|<content> — the | separates the filename from the content. Supports: txt, md, json, csv, html. IMPORTANT: Put the COMPLETE content after |, never truncate.",
    example: "export md report.md|# My Report\n\nContent goes here...",
  },
  {
    name: "chat_export",
    description:
      "Ask the AI to compose content AND immediately save it to a file — all in one step. " +
      "Use this instead of 'chat' + 'export' when writing long documents (reports, essays, summaries). " +
      "Format: chat_export <format> <filename>|<prompt describing what to write>. " +
      "The AI writes the full content from the prompt and saves it — you do NOT need to include the content inline. " +
      "PREFER this tool over the two-step chat→export pattern.",
    example:
      "chat_export md ukraine_war.md|Write a comprehensive report on the Ukraine-Russia war covering its origins, key events, humanitarian impact, and current status",
  },
  {
    name: "mcp",
    description:
      "Manage and inspect MCP servers, tools, and resources. Use for invoking external model-context tools or reading shared resources. | mcp <subcommand>",
    example: "mcp_list",
  },
  {
    name: "mcp_list",
    description: "List registered MCP servers. | mcp_list",
    example: "mcp_list",
  },
  {
    name: "mcp_connect",
    description: "Connect or reconnect to an MCP server. | mcp_connect <name>",
    example: "mcp_connect my-server",
  },
  {
    name: "mcp_disconnect",
    description: "Disconnect from an MCP server. | mcp_disconnect <name>",
    example: "mcp_disconnect my-server",
  },
  {
    name: "mcp_add",
    description:
      "Add a new MCP server (template or explicit). | mcp_add <template|name ...>",
    example: "mcp_add filesystem",
  },
  {
    name: "mcp_remove",
    description: "Remove an MCP server from the registry. | mcp_remove <name>",
    example: "mcp_remove my-server",
  },
  {
    name: "mcp_tools",
    description:
      "List available MCP tools (optionally filter by server). | mcp_tools [server]",
    example: "mcp_tools",
  },
  {
    name: "mcp_call",
    description:
      "Call an MCP tool directly. | mcp_call <tool-name> [json-args]",
    example: 'mcp_call read_file {"path":"./README.md"}',
  },
  {
    name: "mcp_resources",
    description: "List MCP-shared resources. | mcp_resources [server]",
    example: "mcp_resources",
  },
  {
    name: "mcp_read",
    description: "Read a resource exposed by MCP. | mcp_read <resource-uri>",
    example: "mcp_read mcp://filesystem/README.md",
  },
  {
    name: "mcp_prompts",
    description: "List prompts exposed by MCP servers. | mcp_prompts [server]",
    example: "mcp_prompts",
  },
  {
    name: "tq_add",
    description:
      "Add a task to the priority queue and get its ID. | tq_add <description> [--priority high] [--retries 2]",
    example: "tq_add Sync database --priority high --retries 2",
  },
  {
    name: "tq_list",
    description:
      "List all queued tasks. | tq_list [--status pending|running|completed|failed]",
    example: "tq_list",
  },
  {
    name: "tq_status",
    description: "Check status of a specific task. | tq_status <id>",
    example: "tq_status abc12345",
  },
  {
    name: "tq_cancel",
    description: "Cancel a pending or running task. | tq_cancel <id>",
    example: "tq_cancel abc12345",
  },
  {
    name: "tq_drain",
    description: "Wait until the queue is empty. | tq_drain",
    example: "tq_drain",
  },
  {
    name: "finance",
    description:
      "Generate a financial report for a stock ticker. | finance <ticker>",
    example: "finance AAPL",
  },
  {
    name: "email",
    description: "Read emails from inbox and summarize them. | email",
    example: "email",
  },
  {
    name: "email_send",
    description:
      "Send an email. | email_send to <email> subject <subject> body <body>",
    example: "email_send to john@example.com subject Hello body How are you?",
  },
  {
    name: "vdb_query",
    description:
      "Query a vector database collection by text. | vdb_query <collection> <query>",
    example: "vdb_query songs Bohemian Rhapsody",
  },
  {
    name: "vdb_add",
    description:
      "Add a document to the vector database collection. | vdb_add <collection> <document>",
    example:
      "vdb_add songs Bohemian Rhapsody Bohemian Rhapsody is a song by the English rock band Queen.",
  },
  {
    name: "vdb_ingest",
    description:
      "Ingest a document into the vector database collection. | vdb_ingest <collection> <path>",
    example: "vdb_ingest songs report.pdf",
  },
  {
    name: "vdb_create",
    description:
      "Create a vector database collection. | vdb_create <collection>",
    example: "vdb_create songs",
  },
  {
    name: "vdb_list",
    description: "List specific collections. | vdb_list <collection>",
    example: "vdb_list songs",
  },
  {
    name: "vdb_info",
    description:
      "Get detailed information about a vector database collection. | vdb_info <collection>",
    example: "vdb_info songs",
  },
  {
    name: "vdb_delete",
    description:
      "Delete a document from a vector database collection. | vdb_delete <collection> <doc_id>",
    example: "vdb_delete songs Bohemian Rhapsody",
  },
  {
    name: "vdb_drop",
    description: "Delete a vector database collection. | vdb_drop <collection>",
    example: "vdb_drop songs",
  },
  {
    name: "vdb_clear",
    description: "Delete all collections in the vector database. | vdb_clear",
    example: "vdb_clear",
  },
  {
    name: "chat",
    description:
      "Ask the AI a question or request written content. Use this for reasoning, writing reports, summarising, or answering questions. Returns the FULL complete text — never truncated. Use the full output directly as content for an export step.",
    example:
      "chat Write a comprehensive report on TypeScript ORMs covering Prisma, TypeORM, MikroORM, Drizzle",
  },
  {
    name: "finish",
    description:
      "Declare the goal complete and provide the final answer to the user. Always use this as your LAST step.",
    example: "finish The analysis is complete. Here are the results: ...",
  },
];

export type ToolRunner = (
  provider: AIProvider,
  input: string,
  model?: string,
) => Promise<string>;

function ensureCommandPrefix(input: string, command: string): string {
  const trimmed = input.trim();
  if (!trimmed) return command;
  return trimmed.toLowerCase().startsWith(`${command.toLowerCase()} `)
    ? trimmed
    : `${command} ${trimmed}`;
}

/**
 * Maps tool name -> CAKE handler (returns plain string).
 *
 * BUG FIX: The chat tool runner previously went through a wrap() helper that
 * returned res.text — which is correct. However, the executionState layer then
 * compressed that text to 120 chars before storing in recentSteps, so when the
 * planner built the next step's context it only saw the truncated summary and
 * wrote THAT into the export file.
 *
 * The fix is in executionState.ts (fullOutput field), but we also explicitly
 * document here that chat's raw string output must NOT be truncated by callers.
 */
export function getToolRunner(toolName: string): ToolRunner | null {
  const wrap =
    (
      fn: (p: AIProvider, i: string, m?: string) => Promise<{ text: string }>,
    ): ToolRunner =>
    async (provider, input, model) => {
      const res = await fn(provider, input, model);
      // Return the COMPLETE text — compression happens only in executionState
      // for the planner context display, never for the actual tool output passed
      // between steps.
      return res.text;
    };

  switch (toolName) {
    case "search":
      return wrap(H.handleSearch);
    case "deep_search":
      return wrap(H.handleDeepSearch);
    case "bash":
      return wrap(H.handleBash);
    case "file_read":
      return wrap(H.handleFileRead);
    case "file_summarize":
      return wrap(H.handleFileSummarize);
    case "file_compose":
      return wrap(H.handleFileCompose);
    case "file_find":
      return wrap(H.handleFindFile);
    case "file_list":
      return wrap(H.handleFileList);
    case "directory_tree":
      return wrap(H.handleDirectoryTree);
    case "todo_add":
      return wrap(H.handleTodoAdd);
    case "todo_list":
      return wrap(H.handleTodoList);
    case "todo_remove":
      return wrap(H.handleTodoRemove);
    case "todo_remove_all":
      return wrap(H.handleTodoRemoveAll);
    case "cron_list":
      return wrap(H.handleListCron);
    case "cron_schedule":
      return wrap(H.handleScheduleTask);
    case "cron_remove":
      return wrap(H.handleRemoveCron);
    case "calendar_list":
      return wrap(H.handleCalendarList);
    case "calendar_create":
      return wrap(H.handleCalendarCreate);
    case "calendar_remove":
      return wrap(H.handleCalendarRemove);
    case "weather":
      return wrap(H.handleWeather);
    case "news":
      return wrap(H.handleNews);
    case "notify":
      return wrap(H.handleNotify);
    case "document_read":
      return wrap(H.handleReadDocument);
    case "document_summarize":
      return wrap(H.handleSummarizeDocument);
    case "document_ask":
      return wrap(H.handleAskDocument);
    case "export":
      return wrap(H.handleExport);
    case "chat_export":
      return wrap(H.handleChatExport);
    case "mcp":
      return wrap(H.handleMcp);
    case "mcp_list":
      return wrap(H.handleMcpList);
    case "mcp_connect":
      return wrap(H.handleMcpConnect);
    case "mcp_disconnect":
      return wrap(H.handleMcpDisconnect);
    case "mcp_add":
      return wrap(H.handleMcpAdd);
    case "mcp_remove":
      return wrap(H.handleMcpRemove);
    case "mcp_enable":
      return wrap(H.handleMcpEnable);
    case "mcp_disable":
      return wrap(H.handleMcpDisable);
    case "mcp_tools":
      return wrap(H.handleMcpTools);
    case "mcp_call":
      return wrap(H.handleMcpCall);
    case "mcp_resources":
      return wrap(H.handleMcpResources);
    case "mcp_read":
      return wrap(H.handleMcpRead);
    case "mcp_prompts":
      return wrap(H.handleMcpPrompts);
    case "tq_add":
      return wrap(H.handleTqAdd);
    case "tq_list":
      return wrap(H.handleTqList);
    case "tq_status":
      return wrap(H.handleTqStatus);
    case "tq_cancel":
      return wrap(H.handleTqCancel);
    case "tq_pause":
      return wrap(H.handleTqPause);
    case "tq_resume":
      return wrap(H.handleTqResume);
    case "tq_retry":
      return wrap(H.handleTqRetry);
    case "tq_drain":
      return wrap(H.handleTqDrain);
    case "tq_stats":
      return wrap(H.handleTqStats);
    case "finance":
      return wrap(H.handleFinanceReport);
    case "vdb_query":
      return wrap(H.handleVdbQuery);
    case "vdb_add":
      return wrap(H.handleVdbAdd);
    case "vdb_ingest":
      return wrap(H.handleVdbIngest);
    case "vdb_create":
      return wrap(H.handleVdbCreate);
    case "vdb_list":
      return wrap(H.handleVdbList);
    case "vdb_info":
      return wrap(H.handleVdbInfo);
    case "vdb_delete":
      return wrap(H.handleVdbDelete);
    case "vdb_drop":
      return wrap(H.handleVdbDrop);
    case "vdb_clear":
      return wrap(H.handleVdbClear);
    case "async":
      return async (provider, input, model) => {
        const res = await H.handleAsync(
          provider,
          ensureCommandPrefix(input, "async"),
          model,
        );
        return res.text;
      };
    case "async_list":
      return wrap(H.handleAsyncList);
    case "async_status":
      return async (provider, input) => {
        const res = await H.handleAsyncStatus(
          provider,
          ensureCommandPrefix(input, "async_status"),
        );
        return res.text;
      };
    case "async_cancel":
      return async (provider, input) => {
        const res = await H.handleAsyncCancel(
          provider,
          ensureCommandPrefix(input, "async_cancel"),
        );
        return res.text;
      };
    case "email":
      return wrap(H.handleEmail);
    case "email_send":
      return wrap(H.handleSendEmail);
    case "chat":
      return wrap(H.handleChat);
    case "finish":
      // finish is handled by the loop itself, not dispatched
      return async (_p, input) => input;
    default:
      return null;
  }
}
