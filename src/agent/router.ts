import type { AIProvider, ChatResult } from "../providers/types.js";
import * as H from "./handlers/index.js";

export type Handler = (
  provider: AIProvider,
  input: string,
  model?: string,
) => Promise<ChatResult>;

interface Route {
  /** One or more patterns to test against lowercased input */
  patterns: RegExp[];
  handler: Handler;
}

export const ROUTES: Route[] = [
  // Email
  { patterns: [/\b(my emails|inbox|mail)\b/, /^email$/], handler: H.handleEmail },
  { patterns: [/\b(send email|write email|compose email)\b/, /^email_send\b/], handler: H.handleSendEmail },

  // News
  {
    patterns: [/\b(news|headlines|today'?s news)\b/, /^news$/],
    handler: H.handleNews,
  },

  // Calendar — create (ต้องมาก่อน)
  {
    patterns: [
      /\b(add|create|set|schedule)\b.*\b(event|meeting|appointment)\b/,
    ],
    handler: H.handleCalendarCreate,
  },

  // Calendar — list
  {
    patterns: [/\b(calendar_list|schedule_list|upcoming_list|events?)\b/, /^calendar_list$/],
    handler: H.handleCalendarList,
  },

  // Calendar - remove
  {
    patterns: [/^calendar_remove\b/],
    handler: H.handleCalendarRemove,
  },

  // Todos — add
  {
    patterns: [/\b(add|create|new)\b.*\b(todo|task)\b/, /^todo_add\b/],
    handler: H.handleTodoAdd,
  },

  // Todos — list
  {
    patterns: [
      /\b(todo|task)s?\b.*\b(show|view|list|my)\b/,
      /\b(show|view|list)\b.*\b(todo|task)s?\b/,
      /^todo_list$/,
    ],
    handler: H.handleTodoList,
  },

  // Todos — remove
  {
    patterns: [
      /\b(remove|delete)\b.*\b(todo|task)\b/i,
      /^todo_remove\b/,
    ],
    handler: H.handleTodoRemove,
  },

  // Todos — remove all
  {
    patterns: [
      /\b(remove|delete|clear)\b.*\ball\b.*\b(todo|task)s?\b/i,
      /^todo_remove_all$/,
    ],
    handler: H.handleTodoRemoveAll,
  },

  // Plan
  {
    patterns: [/\b(plan|planning|break\s?down)\b.*\b(goal|project)\b/],
    handler: H.handlePlan,
  },

  // Document — summarize
  {
    patterns: [/\b(summarize|summary)\b.*\.(pdf|docx|txt)\b/i],
    handler: H.handleSummarizeDocument,
  },

  // Document — read
  {
    patterns: [/\b(read|open|show)\b.*\.(pdf|docx|txt)\b/i],
    handler: H.handleReadDocument,
  },

  // Document - ask
  {
    patterns: [/\b(ask|question)\b.*\.(pdf|docx|txt)\b/i],
    handler: H.handleAskDocument,
  },

  // File — list
  {
    patterns: [/^ls\b/, /\b(list|dir)\b.*\b(file|folder|directory)\b/, /^file_list\b/],
    handler: H.handleFileList,
  },

  // File - create directory tree
  {
    patterns: [
      /^tree(\s+.+)?$/, // tree หรือ tree src
      /^ls\s+tree(\s+.+)?$/, // ls tree src
      /\b(show|list|print)\b.*\b(tree|structure)\b/, // show tree structure
      /\b(tree|structure)\b.*\b(project|folder|directory)\b/, // tree project
    ],
    handler: H.handleDirectoryTree,
  },

  // File — read
  {
    patterns: [/^cat\s/, /\b(read|show|open|cat)\b\s+\S+/],
    handler: H.handleFileRead,
  },

  // File — summarize
  {
    patterns: [/\b(summarize|summary of)\b\s+\S+/],
    handler: H.handleFileSummarize,
  },

  // File — compose
  {
    patterns: [/\b(compose|create|write)\b\s+file\s+\S+/, /^file_compose\b/],
    handler: H.handleFileCompose,
  },

  // Search
  {
    patterns: [/\b(search|find|what is|who is|look up|google)\b/],
    handler: H.handleSearch,
  },

  // Diagnose
  {
    patterns: [/\b(diagnose|diagnosis|healthcheck|system check)\b/i],
    handler: H.handleDiagnoseSystem,
  },

  // Performance
  {
    patterns: [/\b(performance|perf|speed|slow)\b/i],
    handler: H.handleDiagnosePerformance,
  },

  // Memory Index
  {
    patterns: [/\b(index|learn|remember)\b.*\.(pdf|docx|txt)\b/i],
    handler: H.handleIndexDocument,
  },

  // Cron / Scheduling
  {
    patterns: [/\b(list|show)\b.*\b(cron|job|schedule)s?\b/i],
    handler: H.handleListCron,
  },
  {
    patterns: [/\b(remove|delete|cancel)\b.*\b(job|task|cron)\b/i],
    handler: H.handleRemoveCron,
  },
  {
    patterns: [/\b(schedule|every|remind me to)\b/i],
    handler: H.handleScheduleTask,
  },
  {
    patterns: [/\b(test notify|test notification)\b/i],
    handler: H.handleTestNotify,
  },
  {
    patterns: [/\b(notify|remind|alert)\b\s+.+/i],

    handler: H.handleNotify,
  },

  // Finance
  {
    patterns: [/\b(finance|financial|stock|market)\b/i],
    handler: H.handleFinanceReport,
  },

  // Weather
  {
    patterns: [/\b(weather)\b/i],
    handler: H.handleWeather,
  },

  {
    patterns: [
      /^(export|save|write)\s+(txt|md|json|csv|html|text|markdown)\b/i,
    ],
    handler: H.handleExport,
  },
];

/**
 * Returns the handler for the first matching route, or null if no route matches.
 */
export function matchRoute(input: string): Handler | null {
  const lower = input.toLowerCase();
  for (const route of ROUTES) {
    if (route.patterns.some((p) => p.test(lower))) return route.handler;
  }
  return null;
}
