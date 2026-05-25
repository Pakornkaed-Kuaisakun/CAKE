/**
 * src/agent/preClassifier.ts
 *
 * Zero-latency pre-classifier. Runs before the AI intent router.
 * Returns "chat", "tool", or "ambiguous" with no LLM call.
 *
 * DESIGN NOTES
 * ────────────────────────────────────────────────────────────────────────────
 * TOOL_PREFIXES  — unambiguous CLI command words that can ONLY start tool
 *                  requests (snake_case intents + clear action nouns).
 *                  Do NOT add everyday English verbs here (read / ask / write /
 *                  find / search / summarize …) because they also appear in
 *                  conversational sentences → false-positive "tool", then
 *                  matchRoute() fails, and we fall through to aiIntentRouter
 *                  wasting a full LLM call.
 *
 * TOOL_PATTERNS  — regex patterns that are precise enough to distinguish a
 *                  real tool trigger from a chat sentence even when the verb
 *                  is shared (e.g. file extension, time expression, $TICKER).
 *
 * CHAT_PATTERNS  — patterns that conclusively identify conversational input
 *                  so they can skip the router entirely.
 *
 * BUG FIX: "search" was missing from TOOL_PREFIXES even though `search <query>`
 * typed verbatim is an unambiguous tool command. Its absence forced every
 * direct "search foo" input through the AI intent router unnecessarily.
 * Added "search", "notify", "notify", "export", "plan", and "scan" which are
 * all single-word unambiguous CLI verbs with no conversational meaning.
 */

// ── Unambiguous command-word prefixes ─────────────────────────────────────
const TOOL_PREFIXES = new Set([
  // Explicit snake_case intent IDs (safe: no natural-language overlap)
  "email_send",
  "directory_tree",
  "file_list",
  "file_read",
  "file_find",
  "file_summarize",
  "file_compose",
  "todo_list",
  "todo_add",
  "todo_remove",
  "todo_remove_all",
  "calendar_list",
  "calendar_create",
  "calendar_remove",
  "cron_list",
  "cron_schedule",
  "cron_remove",
  "document_read",
  "document_summarize",
  "document_ask",
  "test_notify",
  "memory_index",
  "security_scan",
  // Short unambiguous CLI words
  "ls",
  "cat",
  "tree", // UNIX command
  "bash",
  "shell",
  "news",
  "weather",
  "finance",
  "cron",
  "auto",
  "agent",
  "autonomous",
  "plugins",
  "screenshot",
  "vision",
  "diagnose",
  "diagnosis",
  // BUG FIX: these were missing — all are unambiguous single-word CLI commands
  "search", // "search <query>" always routes to handleSearch
  "notify", // "notify <msg>" always routes to handleNotify
  "export", // "export <fmt> <file>" always routes to handleExport
  "plan", // "plan <goal>" always routes to handlePlan
  "scan", // "scan <dir>" always routes to handleSecurityScan
  "email", // "email" on its own = read inbox
  "performance",
  // Vector database commands
  "vdb",
  "vdb_query",
  "vdb_search",
  "vdb_ask",
  "vdb_add",
  "vdb_insert",
  "vdb_store",
  "vdb_ingest",
  "vdb_import",
  "vdb_index",
  "vdb_load",
  "vdb_create",
  "vdb_list",
  "vdb_ls",
  "vdb_show",
  "vdb_delete",
  "vdb_remove",
  "vdb_del",
  "vdb_drop",
  "vdb_destroy",
  "vdb_clear",
  "vdb_empty",
  "vdb_flush",
  "vdb_info",
  "vdb_stat",
  // ── Locker ─────────────────────────────────────────────────────────────────
  "locker",
  "locker_add",
  "locker_get",
  "locker_show",
  "locker_list",
  "locker_delete",
  "locker_remove",
  "locker_update",
  "locker_clear",
  "locker_info",
  "mcp",
  "mcp_list",
  "mcp_connect",
  "mcp_disconnect",
  "mcp_add",
  "mcp_remove",
  "mcp_enable",
  "mcp_disable",
  "mcp_tools",
  "mcp_call",
  "mcp_resources",
  "mcp_read",
  "mcp_prompts",
]);

// ── Regex-based tool signals (precise enough to override ambiguity) ────────
const TOOL_PATTERNS: RegExp[] = [
  // File extensions → must be a file operation
  /\.(pdf|docx|txt|csv|json|md|js|ts|py|sh|exe|zip)\b/i,
  // Time/schedule expressions
  /\bevery\s+(day|hour|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|night)\b/i,
  /\bremind me (to|at|every)\b/i,
  /\bat \d{1,2}(:\d{2})?\s*(am|pm)\b/i,
  // Finance
  /\$[A-Z]{1,5}\b/,
  /\b[A-Z]{2,5}:\s/,
  // Explicit send-email phrasing
  /\bsend\s+(an?\s+)?email\b/i,
  // Task/event creation with object noun
  /\b(add|create|new)\s+(task|todo|event|meeting|appointment)\b/i,
  // Listing owned items
  /\b(show|list|view)\s+my\s+(email|todo|task|calendar|event|schedule)\b/i,
  // Shell prefix  $ command
  /^\$\s+\S+/,
  // "bash …", "run ls …", "shell echo …"
  /^(bash|run|shell)\s+\S/i,
  // Autonomous agent prefix
  /^(auto|agent|autonomous)\s+/i,
  // Explicit file/document commands with path-like argument
  /\b(read|open|show|cat)\s+["']?[\w./\\-]+\.[a-z]{1,5}\b/i,
  /\b(summarize|summary of)\s+["']?[\w./\\-]+\.[a-z]{1,5}\b/i,
  /\b(find|search)\s+(file|folder|directory)\b/i,
  // Notify with message body
  /\b(notify|remind|alert)\s+.{3,}/i,
  // Stock / financial report
  /\b(stock|financial report|finance report)\b/i,
  // Security scan
  /\b(security scan|virus scan|malware scan|scan for)\b/i,
  // Export / save with format
  /^(export|save|write|chat_export)\s+(txt|md|json|csv|html|text|markdown)\b/i,
  // Screenshot / vision
  /what'?s?\s+on\s+(my\s+)?screen/i,
];

// ── Conversational patterns that definitively mean chat ───────────────────
const CHAT_PATTERNS: RegExp[] = [
  // Question words followed by auxiliary verbs
  /^(what|who|where|when|why|how)\s+(is|are|was|were|do|does|did|can|could|would|should|will)\b/i,
  // Instructional openers
  /^(tell me|explain|describe|define|what'?s|elaborate)\b/i,
  // Direct questions to the AI
  /^(do you|are you|can you|could you|would you|will you|have you)\b/i,
  // Comparative / conceptual
  /\b(difference between|compare|vs\.?|versus|pros and cons|trade.?off)\b/i,
  // Help phrasing
  /^help me (understand|learn|figure|think|decide|write|know)\b/i,
  // First-person statements
  /^i (need|want|think|feel|believe|wonder|don'?t|am|was|have|had|would|could)\b/i,
  // Ends in question mark (natural language question)
  /\?$/,
  // "How do I / How to" style
  /^how (do i|does|to|can i)\b/i,
  // "Give me an example/idea…"
  /^give me (an? )?(example|idea|tip|summary|overview|explanation|list of)\b/i,
  // Greetings (belt-and-suspenders with isChatFastPath)
  /^(hi|hey|hello|yo|howdy|sup|thanks?|thank you|ok(ay)?)\b/i,
  // Opinion / preference questions
  /^(which|should i|is it (better|good|bad|safe|worth)|what('?s| is) (the best|a good|better))\b/i,
  // "Write me a poem / joke / story" → conversational generation, not file compose
  /^write (me|a|an)\s+(poem|joke|story|song|haiku|essay|letter|message|email draft)\b/i,
  // "Read me a …" → spoken-word request, not file read
  /^read me\b/i,
  // "Find out / Find a way" → conversational, not file find
  /^find (out|a way|the|an)\b/i,
  // "Ask yourself / ask the AI" → conversational
  /^ask (yourself|the|me|him|her|them)\b/i,
  // "Remember when / remember that" → conversational
  /^remember (when|that|if|how|the)\b/i,
  // "Search for an answer" vs "search <query>" caught by TOOL_PATTERNS
  /^search (for an?|the internet for|online for)\b/i,
];

export type PreClassification = "chat" | "tool" | "ambiguous";

export function preClassify(input: string): PreClassification {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  const firstWord = lower.split(/\s+/)[0];

  // 1. Exact first-word match against unambiguous CLI command words
  if (TOOL_PREFIXES.has(firstWord)) return "tool";

  // 2. CHAT patterns first — intercept conversational inputs before tool patterns
  for (const p of CHAT_PATTERNS) if (p.test(trimmed)) return "chat";

  // 3. Precise regex-based tool signals
  for (const p of TOOL_PATTERNS) if (p.test(trimmed)) return "tool";

  // 4. Short inputs with no command verb → probably chat
  if (trimmed.length < 60 && !/[\/\\]/.test(trimmed)) {
    const hasCommandVerb =
      /^(get|fetch|show|list|create|add|remove|delete|send|read|open|run|execute|scan|check|generate|make|build|compose|write|export|save|find|search|schedule|summarize|index|notify|remind|alert|diagnose|deploy|install)\b/i.test(
        trimmed,
      );
    if (!hasCommandVerb) return "chat";
  }

  return "ambiguous";
}
