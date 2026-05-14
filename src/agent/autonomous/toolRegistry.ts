import type { AIProvider } from "../../providers/types.js";
import type { AgentTool } from "./types.js";
import * as H from "../handlers/index.js";

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "search",
    description: "Search the web for current information on any topic.",
    example: "search latest Node.js LTS version",
  },
  {
    name: "bash",
    description: "Run a shell command and get its output.",
    example: "bash ls -la src/",
  },
  {
    name: "file_read",
    description: "Read the contents of a file on disk.",
    example: "file_read src/agent/index.ts",
  },
  {
    name: "file_summarize",
    description: "AI-summarize a file.",
    example: "file_summarize README.md",
  },
  {
    name: "directory_tree",
    description: "Show the directory structure of a path.",
    example: "directory_tree src",
  },
  {
    name: "todo_add",
    description: "Add a task to the todo list.",
    example: "todo_add Review the authentication module",
  },
  {
    name: "todo_list",
    description: "List all pending todo tasks.",
    example: "todo_list",
  },
  {
    name: "calendar_list",
    description: "List upcoming calendar events.",
    example: "calendar_list",
  },
  {
    name: "weather",
    description: "Get the current weather report.",
    example: "weather",
  },
  {
    name: "news",
    description:
      "Fetch and summarize recent news, optionally filtered by topic.",
    example: "news AI",
  },
  {
    name: "notify",
    description: "Send a desktop notification with a message.",
    example: "notify Task complete!",
  },
  {
    name: "document_summarize",
    description: "Summarize a PDF, DOCX, or TXT document.",
    example: "document_summarize report.pdf",
  },
  {
    name: "export",
    description: "Export text content to a file (txt, md, json, csv, html).",
    example: "export md output.md",
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
    case "directory_tree":
      return wrap(H.handleDirectoryTree);
    case "todo_add":
      return wrap(H.handleTodoAdd);
    case "todo_list":
      return wrap(H.handleTodoList);
    case "calendar_list":
      return wrap(H.handleCalendarList);
    case "weather":
      return wrap(H.handleWeather);
    case "news":
      return wrap(H.handleNews);
    case "notify":
      return wrap(H.handleNotify);
    case "document_summarize":
      return wrap(H.handleSummarizeDocument);
    case "export":
      return wrap(H.handleExport);
    case "chat":
      return wrap(H.handleChat);
    case "finish":
      // finish is handled by the loop itself, not dispatched
      return async (_p, input) => input;
    default:
      return null;
  }
}
