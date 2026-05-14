import type { AIProvider, ChatResult } from "../providers/types.js";
import * as H from "./handlers/index.js";

export type Handler = (
  provider: AIProvider,
  input: string,
  model?: string,
) => Promise<ChatResult>;

interface Route {
  patterns: RegExp[];
  handler: Handler;
}

// ─── Fast-path: greetings and simple chat bypass ALL routing ────────────────
// These never need an LLM router call — just go straight to handleChat.
const CHAT_FAST_RE =
  /^(hi|hey|hello|yo|howdy|sup|what'?s up|good\s*(morning|afternoon|evening|night)|thanks?|thank you|ok|okay|sure|got it|bye|goodbye|see you|cya)[\s!?.]*$/i;

export function isChatFastPath(input: string): boolean {
  return CHAT_FAST_RE.test(input.trim());
}

export const ROUTES: Route[] = [
  // Email
  {
    patterns: [/\b(my emails|inbox|mail)\b/, /^email$/],
    handler: H.handleEmail,
  },
  {
    patterns: [/\b(send email|write email|compose email)\b/, /^email_send\b/],
    handler: H.handleSendEmail,
  },

  // News
  {
    patterns: [/\b(news|headlines|today'?s news)\b/, /^news$/],
    handler: H.handleNews,
  },

  // Calendar — create (must come before list)
  {
    patterns: [
      /\b(add|create|set|schedule)\b.*\b(event|meeting|appointment)\b/,
    ],
    handler: H.handleCalendarCreate,
  },

  // Calendar — list
  {
    patterns: [
      /\b(calendar_list|schedule_list|upcoming_list|events?)\b/,
      /^calendar_list$/,
    ],
    handler: H.handleCalendarList,
  },

  // Calendar - remove
  { patterns: [/^calendar_remove\b/], handler: H.handleCalendarRemove },

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
    patterns: [/\b(remove|delete)\b.*\b(todo|task)\b/i, /^todo_remove\b/],
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

  // Document — ask
  {
    patterns: [/\b(ask|question)\b.*\.(pdf|docx|txt)\b/i],
    handler: H.handleAskDocument,
  },

  // File — list
  {
    patterns: [
      /^ls\b/,
      /\b(list|dir)\b.*\b(file|folder|directory)\b/,
      /^file_list\b/,
    ],
    handler: H.handleFileList,
  },

  // File — directory tree
  {
    patterns: [
      /^tree(\s+.+)?$/,
      /^ls\s+tree(\s+.+)?$/,
      /\b(show|list|print)\b.*\b(tree|structure)\b/,
      /\b(tree|structure)\b.*\b(project|folder|directory)\b/,
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

  // File — find
  {
    patterns: [
      /\b(find|search)\b.*\b(file|folder|directory)\b/,
      /^find\s+\S+/,
      /^file_find\b/,
    ],
    handler: H.handleFindFile,
  },

  // ⚠️  REMOVED the over-broad search pattern:
  //   /\b(search|find|what is|who is|look up|google)\b/
  // This was matching almost EVERY conversational input ("what is..." = chat)
  // and forcing an unnecessary LLM intent-routing call.
  // Explicit "search <query>" commands still work via intentMap.
  { patterns: [/^(search|look up|google)\s+/i], handler: H.handleSearch },

  // Diagnose
  {
    patterns: [/\b(diagnose|diagnosis|healthcheck|system check)\b/i],
    handler: H.handleDiagnoseSystem,
  },

  // Performance — require explicit CLI-style trigger, not casual "this is slow"
  {
    patterns: [
      /\b(performance check|perf check|system performance|how fast)\b/i,
      /^performance\b|^perf\b/i,
    ],
    handler: H.handleDiagnosePerformance,
  },

  // Memory Index
  {
    patterns: [/\b(index|learn|remember)\b.*\.(pdf|docx|txt)\b/i],
    handler: H.handleIndexDocument,
  },

  // Cron / Scheduling
  {
    patterns: [/\b(list|show)\b.*\b(cron|job|schedule)s?\b/i, /^cron_list$/],
    handler: H.handleListCron,
  },
  {
    // Must mention cron/job/schedule explicitly to avoid shadowing todo_remove
    patterns: [/\b(remove|delete|cancel)\b.*\b(cron|scheduled\s+job|cron\s+job)\b/i, /^cron_remove\b/],
    handler: H.handleRemoveCron,
  },
  {
    // Scheduling: time-based trigger words — needs a time or recurrence to fire
    patterns: [
      /\bevery\s+(day|hour|week|\w+day|morning|night)\b/i,
      /\bremind me to\b/i,
      /\bat \d{1,2}(:\d{2})?\s*(am|pm)\b.*\b(every|daily|weekly)\b/i,
      /^cron_schedule\b/,
    ],
    handler: H.handleScheduleTask,
  },

  // Notify
  {
    patterns: [/\b(test notify|test notification)\b/i],
    handler: H.handleTestNotify,
  },
  { patterns: [/\b(notify|remind|alert)\b\s+.+/i], handler: H.handleNotify },

  // Finance — require a ticker pattern or explicit finance/stock keywords
  {
    patterns: [
      /\b(finance|financial report|stock price|stock report)\b/i,
      /\$[A-Z]{1,5}\b/,          // $AAPL style
      /^finance\b/i,
    ],
    handler: H.handleFinanceReport,
  },

  // Weather
  { patterns: [/\b(weather)\b/i], handler: H.handleWeather },

  // Export
  {
    patterns: [
      /^(export|save|write)\s+(txt|md|json|csv|html|text|markdown)\b/i,
    ],
    handler: H.handleExport,
  },

  // Security — require compound term to avoid matching "security" in conversation
  {
    patterns: [
      /\b(security scan|virus scan|malware scan|scan for (virus|malware|threats?))\b/i,
      /^security_scan\b/,
      /^scan\s+.+/i,
    ],
    handler: H.handleSecurityScan,
  },

  // Bash / Shell
  {
    patterns: [
      /^(bash|run|shell)\s+.+/i,
      /^\$\s+.+/, // $ ls -la style
    ],
    handler: H.handleBash,
  },

  // Autonomous Agent
  {
    patterns: [/^(run\s+)?(auto|agent|autonomous)\s+/i],
    handler: H.handleAutonomous,
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
