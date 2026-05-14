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
      "Save text content to a file. Format: export <format> <filename>|<content> — the | separates the filename from the content to save. Supports: txt, md, json, csv, html.",
    example: "export md report.md|# My Report\n\nContent goes here...",
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
    name: "chat",
    description:
      "Ask the AI a question or request a piece of written content. Use this for reasoning, summarising, writing, or answering questions that don't need another tool.",
    example: "chat Summarise the key risks in the following text: ...",
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

/** Maps tool name -> CAKE handler (returns plain string)  */
export function getToolRunner(toolName: string): ToolRunner | null {
  const wrap =
    (
      fn: (p: AIProvider, i: string, m?: string) => Promise<{ text: string }>,
    ): ToolRunner =>
    async (provider, input, model) => {
      const res = await fn(provider, input, model);
      return res.text;
    };

  switch (toolName) {
    case "search":
      return wrap(H.handleSearch);
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
    case "finance":
      return wrap(H.handleFinanceReport);
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
