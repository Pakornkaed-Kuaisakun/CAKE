// src/agent/handlers/locker.ts
//
// Handler for the "locker" family of intents.
//
// Intents / commands:
//   locker_add    <label> [--category <cat>]        — store a new secret (prompts for value + password)
//   locker_get    <id|label>                         — reveal a secret (prompts for password)
//   locker_list                                      — show all stored keys (no values)
//   locker_delete <id|label>                         — remove an entry
//   locker_update <id|label>                         — change value / label
//   locker_clear                                     — wipe all entries
//   locker_info                                      — show storage path
//
// Password collection strategy:
//   The handler cannot do interactive prompts itself (Ink owns stdin).
//   Instead, it returns a special NEEDS_PASSWORD sentinel result.
//   useAgent.ts detects this and triggers the Ink password flow
//   (interceptLockerPassword), then calls the handler again with the
//   password injected via __password__:<password> in the input string.
//
// This keeps ALL crypto inside the module layer and the handler stays thin.

import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";
import {
  lockerAdd,
  lockerGet,
  lockerList,
  lockerDelete,
  lockerClear,
  lockerUpdate,
  findEntryByLabel,
  lockerFilePath,
} from "../../modules/locker/index.js";
import { stripVerb, fmtDate, stripQuotes } from "../../shared/utils/utils.js";


// ── Password sentinel ─────────────────────────────────────────────────────────
// Injected into the re-call input when Ink has collected the password.
export const PASSWORD_MARKER = "__password__:";
// Returned to signal the UI that a password prompt is needed.
export const NEEDS_PASSWORD = "__LOCKER_NEEDS_PASSWORD__";
export const NEEDS_NEW_PASSWORD = "__LOCKER_NEEDS_NEW_PASSWORD__";
export const NEEDS_VALUE = "__LOCKER_NEEDS_VALUE__";

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractPassword(input: string): {
  cleaned: string;
  password: string | null;
} {
  const idx = input.indexOf(PASSWORD_MARKER);
  if (idx === -1) return { cleaned: input, password: null };
  const cleaned = input.slice(0, idx).trim();
  const password = input.slice(idx + PASSWORD_MARKER.length).trim();
  return { cleaned, password };
}

// ── locker_add ────────────────────────────────────────────────────────────────

export async function handleLockerAdd(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const { cleaned, password } = extractPassword(input);
  const raw = stripVerb(cleaned, ["locker_add", "locker add"]);

  // Parse: label [--category cat] [__value__:<value>]
  const VALUE_MARKER = "__value__:";
  const valIdx = raw.indexOf(VALUE_MARKER);
  const beforeVal = valIdx !== -1 ? raw.slice(0, valIdx).trim() : raw;

  const catMatch = beforeVal.match(/--category\s+(\S+)/i);
  const category = catMatch?.[1];
  const label = stripQuotes(beforeVal.replace(/--category\s+\S+/i, ""));

  if (!label) {
    return text(
      "Usage: locker_add <label> [--category <category>]\n" +
        'Example: locker_add "GitHub PAT" --category api-keys',
    );
  }

  // Check for __value__ marker (used when we're re-calling after UI collected the value)
  const valueIdx = cleaned.indexOf(VALUE_MARKER);
  let value: string | null = null;
  if (valueIdx !== -1) {
    value = cleaned
      .slice(valueIdx + VALUE_MARKER.length)
      .split(PASSWORD_MARKER)[0]
      .trim();
  }

  if (!value) {
    // Signal UI: need value input
    return text(`${NEEDS_VALUE}:${label}${category ? `:${category}` : ""}`);
  }

  if (!password) {
    // Signal UI: need password
    return text(`${NEEDS_PASSWORD}:add`);
  }

  try {
    const id = lockerAdd(label, value, password, category);
    return text(
      `🔐 Secret stored successfully!\n` +
        `  Label    : ${label}\n` +
        `  ID       : ${id}\n` +
        (category ? `  Category : ${category}\n` : "") +
        `  File     : ${lockerFilePath()}\n\n` +
        `Retrieve with: locker_get ${id}`,
    );
  } catch (err: any) {
    return text(`❌ Failed to store secret: ${err.message}`);
  }
}

// ── locker_get ────────────────────────────────────────────────────────────────

export async function handleLockerGet(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const { cleaned, password } = extractPassword(input);
  const query = stripVerb(cleaned, ["locker_get", "locker get", "locker show"]);

  if (!query) {
    return text(
      "Usage: locker_get <id or label>\n" +
        "Run locker_list to see all stored keys.",
    );
  }

  // Resolve ID
  const entry = findEntryByLabel(query);
  if (!entry) {
    return text(
      `❌ No entry found matching "${query}". Run locker_list to see all keys.`,
    );
  }

  if (!password) {
    return text(`${NEEDS_PASSWORD}:get:${entry.id}:${entry.label}`);
  }

  try {
    const value = lockerGet(entry.id, password);
    return text(
      `🔓 Secret revealed:\n` +
        `  Label    : ${entry.label}\n` +
        (entry.category ? `  Category : ${entry.category}\n` : "") +
        `  Value    : ${value}\n` +
        `  Stored   : ${fmtDate(entry.createdAt)}\n\n` +
        `⚠️  This value is now visible. Clear your terminal history if sensitive.`,
    );
  } catch (err: any) {
    return text(`❌ ${err.message}`);
  }
}

// ── locker_list ───────────────────────────────────────────────────────────────

export async function handleLockerList(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  const entries = lockerList();

  if (entries.length === 0) {
    return text(
      "[LOCKER] No secrets stored yet.\n\n" +
        'Add one with: locker_add "My API Key" --category api-keys',
    );
  }

  const rows = entries.map((e, i) => {
    const short = e.id.slice(0, 8);
    const cat = e.category ? `  [${e.category}]` : "";
    return (
      `${String(i + 1).padStart(3)}. ${e.label}${cat}\n` +
      `     ID: ${short}…  Updated: ${fmtDate(e.updatedAt)}`
    );
  });

  return text(
    `[LOCKER] ${entries.length} secret${entries.length !== 1 ? "s" : ""} stored\n` +
      `File: ${lockerFilePath()}\n` +
      "─".repeat(50) +
      "\n" +
      rows.join("\n\n") +
      "\n\nReveal with: locker_get <id or label>",
  );
}

// ── locker_delete ─────────────────────────────────────────────────────────────

export async function handleLockerDelete(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const query = stripVerb(input, [
    "locker_delete",
    "locker delete",
    "locker remove",
  ]);

  if (!query) {
    return text("Usage: locker_delete <id or label>");
  }

  const entry = findEntryByLabel(query);
  if (!entry) {
    return text(`❌ No entry found matching "${query}".`);
  }

  const deleted = lockerDelete(entry.id);
  if (!deleted) return text(`❌ Could not delete entry "${query}".`);

  return text(
    `🗑️  Deleted secret: "${entry.label}" (${entry.id.slice(0, 8)}…)`,
  );
}

// ── locker_update ─────────────────────────────────────────────────────────────

export async function handleLockerUpdate(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const { cleaned, password } = extractPassword(input);
  const queryRaw = stripVerb(cleaned, ["locker_update", "locker update"]);

  const VALUE_MARKER = "__value__:";
  const valIdx = queryRaw.indexOf(VALUE_MARKER);
  const query = valIdx !== -1 ? queryRaw.slice(0, valIdx).trim() : queryRaw;

  if (!query) {
    return text("Usage: locker_update <id or label>");
  }

  const entry = findEntryByLabel(query);
  if (!entry) {
    return text(`❌ No entry found matching "${query}".`);
  }

  // Need new value + password
  const valueIdx = cleaned.indexOf(VALUE_MARKER);
  let value: string | null = null;
  if (valueIdx !== -1) {
    value = cleaned
      .slice(valueIdx + VALUE_MARKER.length)
      .split(PASSWORD_MARKER)[0]
      .trim();
  }

  if (!value) {
    return text(`${NEEDS_VALUE}:update:${entry.id}:${entry.label}`);
  }

  if (!password) {
    return text(`${NEEDS_PASSWORD}:update:${entry.id}:${entry.label}`);
  }

  try {
    lockerUpdate(entry.id, value, password);
    return text(`✅ Secret updated: "${entry.label}"`);
  } catch (err: any) {
    return text(`❌ ${err.message}`);
  }
}

// ── locker_clear ──────────────────────────────────────────────────────────────

export async function handleLockerClear(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  // Require explicit --confirm flag to prevent accidents
  if (!input.includes("--confirm")) {
    return text(
      "⚠️  This will delete ALL stored secrets permanently.\n" +
        "To confirm, run: locker_clear --confirm",
    );
  }

  const count = lockerClear();
  return text(
    `🗑️  Cleared ${count} secret${count !== 1 ? "s" : ""} from the locker.`,
  );
}

// ── locker_info ───────────────────────────────────────────────────────────────

export async function handleLockerInfo(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  const entries = lockerList();
  const categories = [
    ...new Set(entries.map((e) => e.category).filter(Boolean)),
  ];

  return text(
    `[LOCKER] Secure Key Locker\n` +
      "─".repeat(40) +
      "\n" +
      `  Storage file : ${lockerFilePath()}\n` +
      `  Encryption   : AES-256-GCM\n` +
      `  Key derivation: PBKDF2-SHA256 (210,000 iterations)\n` +
      `  Total secrets: ${entries.length}\n` +
      (categories.length > 0
        ? `  Categories  : ${categories.join(", ")}\n`
        : "") +
      "\n" +
      "Commands:\n" +
      '  locker_add "My Key" --category api-keys\n' +
      "  locker_list\n" +
      "  locker_get <id or label>\n" +
      "  locker_delete <id or label>\n" +
      "  locker_clear --confirm",
  );
}
