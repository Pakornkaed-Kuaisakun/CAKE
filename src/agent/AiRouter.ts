// src/agent/AiRouter.ts
//
// AI intent router — called ONLY for truly ambiguous inputs that could not
// be resolved by the zero-latency pre-classifier or the regex route table.
//
// Design goals:
//   • Deterministic  → temperature 0, maxTokens 20 (longest intent is 14 chars)
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
]);

// ── Prompt (few-shot, compact) ────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an intent classifier for a CLI assistant.
Classify the user input into EXACTLY ONE intent from this list (output the intent name only, no punctuation, no explanation):

chat              — general conversation, greetings, knowledge questions, opinions
email             — read/list inbox
email_send        — compose or send an email
news              — fetch recent headlines
weather           — current weather
finance           — stock price or financial report (e.g. AAPL, $TSLA)
search            — web search for information
calendar_list     — show upcoming events
calendar_create   — add a new event/meeting/appointment
calendar_remove   — delete a calendar event
todo_list         — show tasks/todos
todo_add          — add a task/todo
todo_remove       — delete one task by id
todo_remove_all   — clear all tasks
plan              — break a goal into sub-tasks
cron_list         — list scheduled jobs
cron_schedule     — schedule a recurring job
cron_remove       — delete a scheduled job
notify            — send a desktop notification
test_notify       — test the notification system
file_list         — list files in a directory
file_read         — read/print a file's content
file_summarize    — AI summarize a file
file_compose      — create/write a new file
file_find         — find a file by name or fuzzy query
directory_tree    — show folder structure as a tree
document_read     — read a PDF/DOCX/TXT document
document_summarize— summarize a PDF/DOCX/TXT document
document_ask      — ask a question about a specific document file (must have a filename with extension)
memory_index      — index a document into long-term memory
export            — save/export output to txt/md/json/csv/html
security_scan     — scan files for malware/viruses
diagnose          — run system health check
performance       — check system performance/speed
bash              — run a shell or terminal command
autonomous        — multi-step agent to accomplish a complex goal
plugins           — list loaded plugins or plugin status
screenshot        — capture and describe the screen
vision            — alias for screenshot
vdb               — any local vector database operation (fallback dispatcher)
vdb_query         — search/query local vector database with a question
vdb_add           — add/insert a text snippet into local vector database
vdb_ingest        — ingest/import a file (PDF/DOCX/TXT) into vector database
vdb_create        — create a new vector database collection
vdb_list          — list vector database collections or documents
vdb_delete        — delete a specific document from vector database
vdb_drop          — delete an entire vector database collection
vdb_clear         — remove all documents from a vector database collection
vdb_info          — show vector database collection statistics
locker_add        — store/save a new secret key, password, token or credential
locker_get        — retrieve/show/reveal a stored secret
locker_list       — list all stored secrets (no values shown)
locker_delete     — delete/remove a stored secret
locker_update     — update/change a stored secret's value
locker_clear      — wipe/clear all stored secrets
locker_info       — show locker info and help
mcp               — Show MCP server status overview
mcp_list          — list all MCP servers
mcp_connect       — connect to an MCP server
mcp_disconnect    — disconnect from an MCP server
mcp_add           — add an MCP server
mcp_remove        — remove an MCP server
mcp_enable        — enable an MCP server
mcp_disable       — disable an MCP server
mcp_tools         — list available MCP tools
mcp_call          — call an MCP tool directly
mcp_resources     — list available MCP resources
mcp_read          — read an MCP resource by URI
mcp_prompts       — list available MCP prompts

RULES:
1. Return ONLY the intent name. No extra words, no punctuation.
2. If the input is a question or casual conversation, use "chat".
3. Use "document_ask" ONLY if there is a file with an extension in the input (e.g. report.pdf).
4. If unsure, use "chat".

EXAMPLES (input → intent):
"show me my calendar" → calendar_list
"add meeting with John tomorrow 3pm" → calendar_create
"what's the weather like?" → weather
"AAPL stock price" → finance
"run ls -la" → bash
"$ pwd" → bash
"write a poem about autumn" → chat
"summarize report.pdf" → document_summarize
"find all .ts files" → file_find
"research AI trends and save a report" → autonomous
"remind me to take pills at 8am" → cron_schedule
"notify take pills" → notify
"what is machine learning?" → chat
"how are you?" → chat
"what's on my screen?" → screenshot
"screenshot what app is open?" → screenshot
"analyze my screen" → screenshot
"clear all my todos" → todo_remove_all
"search local database for malaria symptoms" → vdb_query
"add to diseases database: dengue fever causes fever and rash" → vdb_add
"ingest medical-reference.pdf into diseases collection" → vdb_ingest
"create a collection called products" → vdb_create
"list all vector database collections" → vdb_list
"show documents in diseases collection" → vdb_list
"delete document abc123 from diseases" → vdb_delete
"drop the old-data collection" → vdb_drop
"what does the local database say about diabetes?" → vdb_query
"store my GitHub token" → locker_add
"save my API key" → locker_add
"show my AWS secret" → locker_get
"reveal my password" → locker_get
"list my keys" → locker_list
"delete my old token" → locker_delete
"show mcp servers" → mcp
"add mcp filesystem server" → mcp_add
"call mcp tool read_file" → mcp_call
"list mcp tools" → mcp_tools

`;

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
      // BUG FIX: was 12, but longest intent name is "todo_remove_all" = 14 chars.
      // Raised to 20 to guarantee no truncation for any current or future intent.
      maxTokens: 20,
    },
  );

  // ── 3) Sanitise response ─────────────────────────────────────────────────────
  const raw = result.text
    .trim()
    .toLowerCase()
    .replace(/[^a-z_]/g, "") // keep only letters and underscores
    .trim();

  const intent = VALID_INTENTS.has(raw) ? raw : "chat";

  // ── 4) Cache the result (non-chat only) ──────────────────────────────────────
  setCachedIntent(input, intent);

  return intent;
}
