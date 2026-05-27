// src/agent/permissions/index.ts
//
// Permission level system for file-system and shell-affecting operations.
//
// Three levels per operation category:
//   "deny"    — always blocked, no prompt
//   "ask"     — prompt the user before every execution
//   "allow"   — always permitted silently
//
// Operation categories that require permission:
//   "bash"          — any shell command
//   "file_write"    — create or overwrite a file
//   "file_delete"   — delete a file or directory
//   "file_edit"     — modify an existing file
//   "export"        — write output to disk
//
// Permissions are persisted to ~/.cake/permissions.json so choices
// survive restarts. The user can change them at any time via /permissions.

import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PermissionLevel = "deny" | "ask" | "allow";

export type OperationCategory =
  | "bash"
  | "file_write"
  | "file_delete"
  | "file_edit"
  | "export"
  | "chat_export"
  | "finance";

export interface PermissionMap {
  bash: PermissionLevel;
  file_write: PermissionLevel;
  file_delete: PermissionLevel;
  file_edit: PermissionLevel;
  export: PermissionLevel;
  chat_export: PermissionLevel;
  finance: PermissionLevel;
}

export interface PermissionRequest {
  category: OperationCategory;
  /** Human-readable description of what will happen */
  description: string;
  /** The exact command or path, shown to the user */
  detail: string;
}

export type PermissionDecision = "allow" | "deny";

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: PermissionMap = {
  bash: "ask",
  file_write: "ask",
  file_delete: "ask",
  file_edit: "ask",
  export: "allow", // export is explicit intent — allow by default
  chat_export: "allow",
  finance: "ask",
};

// ── Persistence ───────────────────────────────────────────────────────────────

const PERMS_FILE = path.join(CAKE_DIR, "permissions.json");

export function loadPermissions(): PermissionMap {
  try {
    if (!fs.existsSync(PERMS_FILE)) return { ...DEFAULTS };
    const raw = fs.readFileSync(PERMS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PermissionMap>;
    return {
      bash: parsed.bash ?? DEFAULTS.bash,
      file_write: parsed.file_write ?? DEFAULTS.file_write,
      file_delete: parsed.file_delete ?? DEFAULTS.file_delete,
      file_edit: parsed.file_edit ?? DEFAULTS.file_edit,
      export: parsed.export ?? DEFAULTS.export,
      chat_export: parsed.chat_export ?? DEFAULTS.chat_export,
      finance: parsed.finance ?? DEFAULTS.finance,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePermissions(perms: PermissionMap): void {
  if (!fs.existsSync(CAKE_DIR)) fs.mkdirSync(CAKE_DIR, { recursive: true });
  fs.writeFileSync(PERMS_FILE, JSON.stringify(perms, null, 2), "utf-8");
}

export function setPermission(
  category: OperationCategory,
  level: PermissionLevel,
): void {
  const current = loadPermissions();
  current[category] = level;
  savePermissions(current);
}

export function permissionsFilePath(): string {
  return PERMS_FILE;
}

// ── In-memory singleton (refreshed on each check) ─────────────────────────────
// We re-read from disk on every check so /permissions changes take effect
// immediately without restarting the agent.

export function getPermissionLevel(
  category: OperationCategory,
): PermissionLevel {
  return loadPermissions()[category];
}

// ── Guard function ────────────────────────────────────────────────────────────
//
// Call this before any file-affecting operation.
// Returns { allowed: true } or { allowed: false, reason: string }.
//
// For "ask" level the caller must provide an `onAsk` callback that
// displays the prompt to the user and returns their decision.

export interface GuardResult {
  allowed: boolean;
  /** Set when allowed === false */
  reason?: string;
}

export async function guardOperation(
  req: PermissionRequest,
  onAsk: (req: PermissionRequest) => Promise<PermissionDecision>,
): Promise<GuardResult> {
  const level = getPermissionLevel(req.category);

  if (level === "allow") {
    return { allowed: true };
  }

  if (level === "deny") {
    return {
      allowed: false,
      reason: `Operation blocked: "${req.category}" is set to DENY.\nChange with: /permissions ${req.category} allow`,
    };
  }

  // level === "ask"
  const decision = await onAsk(req);
  return {
    allowed: decision === "allow",
    reason: decision === "deny" ? `Operation denied by user.` : undefined,
  };
}

// ── Category detection helpers ────────────────────────────────────────────────

/**
 * Classify a bash command into the permission categories it touches.
 * A command may touch multiple categories (e.g. mv touches file_edit + file_delete).
 */
export function classifyBashCommand(cmd: string): OperationCategory[] {
  const lower = cmd.toLowerCase().trim();
  const cats = new Set<OperationCategory>();

  // Always needs "bash" permission
  cats.add("bash");

  // File deletion patterns
  if (
    /\brm\b/.test(lower) ||
    /\brmdir\b/.test(lower) ||
    /\btrash\b/.test(lower) ||
    /\bunlink\b/.test(lower)
  ) {
    cats.add("file_delete");
  }

  // File creation / write patterns
  if (
    /\btouch\b/.test(lower) ||
    /\bmkdir\b/.test(lower) ||
    /\bcp\b/.test(lower) ||
    /\bscp\b/.test(lower) ||
    /\bwget\b/.test(lower) ||
    /\bcurl\b.*-[oO]/.test(lower) ||
    />\s*\S+/.test(lower) || // redirect write
    /\btee\b/.test(lower) ||
    /\bcat\b.*>/.test(lower) ||
    /\bprintf\b/.test(lower) ||
    /\becho\b.*>/.test(lower) ||
    /\bnpm\s+init\b/.test(lower) ||
    /\byarn\s+init\b/.test(lower)
  ) {
    cats.add("file_write");
  }

  // File edit patterns
  if (
    /\bsed\b.*-i/.test(lower) ||
    /\bawk\b/.test(lower) ||
    /\bperl\b.*-i/.test(lower) ||
    /\bmv\b/.test(lower) ||
    /\brename\b/.test(lower) ||
    /\bchmod\b/.test(lower) ||
    /\bchown\b/.test(lower) ||
    /\btruncate\b/.test(lower) ||
    /\bnpm\s+install\b/.test(lower) ||
    /\byarn\s+add\b/.test(lower) ||
    /\bpip\s+install\b/.test(lower)
  ) {
    cats.add("file_edit");
  }

  return Array.from(cats);
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<OperationCategory, string> = {
  bash: "Shell commands",
  file_write: "Create / write files",
  file_delete: "Delete files",
  file_edit: "Edit / modify files",
  export: "Export output to disk",
  chat_export: "Export file to AI chat (auto command)",
  finance: "Report Stock as PDF",
};

export const LEVEL_ICONS: Record<PermissionLevel, string> = {
  deny: "🚫",
  ask: "❓",
  allow: "✅",
};

export function formatPermissionsTable(perms: PermissionMap): string {
  const rows = (Object.keys(perms) as OperationCategory[]).map((cat) => {
    const level = perms[cat];
    return `  ${LEVEL_ICONS[level]} ${cat.padEnd(14)} ${level.toUpperCase().padEnd(6)}  — ${CATEGORY_LABELS[cat]}`;
  });
  return rows.join("\n");
}
