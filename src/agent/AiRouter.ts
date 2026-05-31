// src/agent/AiRouter.ts
//
// AI intent router — called ONLY for truly ambiguous inputs that could not
// be resolved by the zero-latency pre-classifier or the regex route table.
//
// Design goals:
//   • Deterministic  → temperature 0, maxTokens 30 (covers current intent names)
//   • Compact prompt → cheaper, faster, less hallucination
//   • Few-shot       → prevents the model from writing explanations
//   • Validated      → strips stray whitespace/punctuation from reply

import type { AIProvider } from "../providers/types.js";
import { getFastModel } from "../providers/utils.js";
import { getCachedIntent, setCachedIntent } from "./intentCache.js";

// ── Valid intent names (must match intentMap keys exactly) ────────────────────
const VALID_INTENTS = new Set([
  "chat",
  "email",
  "email_send",
  "news",
  "calendar_list",
  "calendar_create",
  "calendar_remove",
  "todo_list",
  "todo_add",
  "todo_remove",
  "todo_remove_all",
  "plan",
  "file_list",
  "file_read",
  "file_summarize",
  "file_compose",
  "file_find",
  "directory_tree",
  "document_read",
  "document_summarize",
  "document_ask",
  "search",
  "memory_index",
  "cron_list",
  "cron_schedule",
  "cron_remove",
  "notify",
  "test_notify",
  "finance",
  "weather",
  "export",
  "security_scan",
  "diagnose",
  "performance",
  "bash",
  "autonomous",
  "plugins",
  "screenshot",
  "vision",
  "vdb",
  "vdb_query",
  "vdb_add",
  "vdb_ingest",
  "vdb_create",
  "vdb_list",
  "vdb_delete",
  "vdb_drop",
  "vdb_clear",
  "vdb_info",
  "locker",
  "locker_add",
  "locker_get",
  "locker_list",
  "locker_delete",
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
  "async",
  "background",
  "async_list",
  "background_list",
  "async_status",
  "background_status",
  "async_cancel",
  "background_cancel",
  "deep_search",
  "deep_research",
  "tq_add",
  "tq_list",
  "tq_status",
  "tq_cancel",
  "tq_pause",
  "tq_resume",
  "tq_retry",
  "tq_priority",
  "tq_purge",
  "tq_stats",
  "tq_drain",
]);

function resolveIntent(raw: string): string {
  if (VALID_INTENTS.has(raw)) return raw;

  const matches = [...VALID_INTENTS].filter((intent) => intent.startsWith(raw));
  return matches.length === 1 ? matches[0] : "chat";
}

// ── Prompt (few-shot, compact) ────────────────────────────────────────────────
const SYSTEM_PROMPT = `Intent classifier. Output intent name only.
Intents: chat|email|email_send|news|calendar_list|calendar_create|calendar_remove|
todo_list|todo_add|todo_remove|todo_remove_all|plan|file_list|file_read|file_summarize|
file_compose|file_find|directory_tree|document_read|document_summarize|document_ask|
search|memory_index|cron_list|cron_schedule|cron_remove|notify|test_notify|finance|
weather|export|security_scan|diagnose|performance|bash|autonomous|plugins|screenshot|
vision|vdb|vdb_query|vdb_add|vdb_ingest|vdb_create|vdb_list|vdb_delete|vdb_drop|
vdb_clear|vdb_info|locker|locker_add|locker_get|locker_list|locker_delete|locker_update|
locker_clear|locker_info|mcp|mcp_list|mcp_connect|mcp_disconnect|mcp_add|mcp_remove|
mcp_enable|mcp_disable|mcp_tools|mcp_call|mcp_resources|mcp_read|mcp_prompts|
async|background|async_list|async_status|async_cancel|deep_search|deep_research|
tq_add|tq_list|tq_status|tq_cancel|tq_pause|tq_resume|tq_retry|tq_priority|tq_purge|tq_stats|tq_drain

Rules: output name only. unknown→chat. file extension→file op. $TICKER→finance. bash/$ prefix→bash.
Examples: "show calendar"→calendar_list, "AAPL stock"→finance, "run ls"→bash, "hi"→chat`;

export async function aiIntentRouter(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<string> {
  // ── 1) Check intent cache first ─────────────────────────────────────────────
  const cached = getCachedIntent(input);
  if (cached) return cached;

  // ── 2) Call LLM ─────────────────────────────────────────────────────────────
  const fastModel = model || getFastModel(provider.name);

  const result = await provider.chat(
    [{ role: "user", content: `User input: "${input}"` }],
    {
      model: fastModel,
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0,
      // Keep enough room for the longest current intent plus provider-specific
      // tokenization overhead and harmless trailing whitespace.
      maxTokens: 30,
    },
  );

  // ── 3) Sanitise response ─────────────────────────────────────────────────────
  const raw = result.text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "") // keep intent-safe characters
    .trim();

  const intent = resolveIntent(raw);

  // ── 4) Cache the result (non-chat only) ──────────────────────────────────────
  setCachedIntent(input, intent);

  return intent;
}
