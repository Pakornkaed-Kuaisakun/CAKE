/**
 * src/agent/preClassifier.ts
 *
 * Zero-latency pre-classifier. Runs before the AI intent router.
 * Returns "chat", "tool", or "ambiguous" with no LLM call.
 */

const TOOL_PREFIXES = new Set([
  "email",
  "email_send",
  "news",
  "calendar",
  "todo",
  "plan",
  "file",
  "ls",
  "cat",
  "tree",
  "find",
  "search",
  "look up",
  "google",
  "document",
  "summarize",
  "summary",
  "read",
  "open",
  "ask",
  "schedule",
  "cron",
  "remind",
  "notify",
  "alert",
  "finance",
  "stock",
  "weather",
  "export",
  "save",
  "write",
  "scan",
  "security",
  "diagnose",
  "diagnosis",
  "performance",
  "index",
  "learn",
  "remember",
  "memory",
  "directory_tree",
  "file_list",
  "file_read",
  "file_find",
  "file_summarize",
  "file_compose",
  "todo_list",
  "todo_add",
  "todo_remove",
  "calendar_list",
  "calendar_create",
  "calendar_remove",
  "cron_list",
  "cron_schedule",
  "cron_remove",
  "test_notify",
  "bash",
  "run",
  "shell",
]);

const TOOL_PATTERNS: RegExp[] = [
  /\.(pdf|docx|txt|csv|json|md|js|ts|py|sh|exe|zip)\b/i,
  /\bevery\s+(day|hour|week|monday|morning|night)\b/i,
  /\bremind me (to|at|every)\b/i,
  /\bat \d{1,2}(:\d{2})?\s*(am|pm)\b/i,
  /\$[A-Z]{1,5}\b/,
  /\b[A-Z]{2,5}:\s/,
  /\bsend\s+(an?\s+)?email\b/i,
  /\b(add|create|new)\s+(task|todo|event|meeting)\b/i,
  /\b(show|list|view)\s+my\s+(email|todo|task|calendar|event|schedule)\b/i,
  /^\$\s+\S+/, // $ command style
];

const CHAT_PATTERNS: RegExp[] = [
  /^(what|who|where|when|why|how)\s+(is|are|was|were|do|does|did|can|could|would|should)\b/i,
  /^(tell me|explain|describe|define|what'?s)\b/i,
  /^(do you|are you|can you|could you|would you|will you)\b/i,
  /\b(difference between|compare|vs\.?|versus)\b/i,
  /^help me\b/i,
  /^i (need|want|think|feel|believe|wonder|don'?t)\b/i,
  /\?$/,
  /^how (do i|does|to|can i)\b/i,
  /^give me (an? )?(example|idea|tip|summary|overview|explanation)\b/i,
];

export type PreClassification = "chat" | "tool" | "ambiguous";

export function preClassify(input: string): PreClassification {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  const firstWord = lower.split(/\s+/)[0];

  if (TOOL_PREFIXES.has(firstWord)) return "tool";
  for (const p of TOOL_PATTERNS) if (p.test(trimmed)) return "tool";
  for (const p of CHAT_PATTERNS) if (p.test(trimmed)) return "chat";

  if (trimmed.length < 60 && !/[/\\]/.test(trimmed)) {
    const hasCommandVerb =
      /^(get|fetch|show|list|create|add|remove|delete|send|read|open|run|execute|scan|check|generate|make|build|compose|write|export|save|find|search|schedule|summarize|index)\b/i.test(
        trimmed,
      );
    if (!hasCommandVerb) return "chat";
  }

  return "ambiguous";
}
