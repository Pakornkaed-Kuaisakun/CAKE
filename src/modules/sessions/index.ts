// src/modules/sessions/index.ts
//
// Persistent named conversation sessions.
// Saved as JSON files under ~/.cake/sessions/<name>.json
//
// Each file stores:
//   - session metadata  (name, provider, model, timestamps)
//   - full message history  (role + content pairs)
//
// Public API (all sync-friendly, small files):
//   saveSession(name, messages, meta?)  → SessionFile
//   loadSession(name)                   → SessionFile
//   listSessions()                      → SessionMeta[]
//   deleteSession(name)                 → void
//   sessionExists(name)                 → boolean
//   sessionsDir                         → string (export for display)

import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";
import type { Message } from "../../providers/types.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

export const sessionsDir = path.join(CAKE_DIR, "sessions");

function ensureDir(): void {
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
}

function filePath(name: string): string {
  // Sanitise name: allow alphanumeric, dash, underscore, dot — nothing else
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  if (!safe) throw new Error("Session name cannot be empty.");
  return path.join(sessionsDir, `${safe}.json`);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionMeta {
  name: string;
  provider?: string;
  model?: string;
  messageCount: number;
  savedAt: string; // ISO timestamp of last save
  createdAt: string; // ISO timestamp of first save
}

export interface SessionFile extends SessionMeta {
  messages: Message[];
}

// ── Core operations ───────────────────────────────────────────────────────────

/**
 * Save (or overwrite) a named session.
 * If the session already exists, createdAt is preserved from the old file.
 */
export function saveSession(
  name: string,
  messages: Message[],
  meta: { provider?: string; model?: string } = {},
): SessionFile {
  ensureDir();

  const fp = filePath(name);
  const now = new Date().toISOString();

  // Preserve original createdAt if file already exists
  let createdAt = now;
  if (fs.existsSync(fp)) {
    try {
      const existing = JSON.parse(
        fs.readFileSync(fp, "utf-8"),
      ) as Partial<SessionFile>;
      createdAt = existing.createdAt ?? now;
    } catch {
      // ignore parse errors — will overwrite cleanly
    }
  }

  const session: SessionFile = {
    name,
    provider: meta.provider,
    model: meta.model,
    messageCount: messages.length,
    savedAt: now,
    createdAt,
    messages,
  };

  fs.writeFileSync(fp, JSON.stringify(session, null, 2), "utf-8");
  return session;
}

/**
 * Load a named session. Throws if not found.
 */
export function loadSession(name: string): SessionFile {
  const fp = filePath(name);

  if (!fs.existsSync(fp)) {
    throw new Error(
      `Session "${name}" not found.\n` +
        `Use /session list to see saved sessions.`,
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(fp, "utf-8");
  } catch (err: any) {
    throw new Error(`Could not read session file: ${err.message}`);
  }

  let parsed: SessionFile;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Session file for "${name}" is corrupt.`);
  }

  // Basic shape validation
  if (!Array.isArray(parsed.messages)) {
    throw new Error(`Session file for "${name}" has no messages array.`);
  }

  return parsed;
}

/**
 * List all saved sessions, newest first.
 */
export function listSessions(): SessionMeta[] {
  ensureDir();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: SessionMeta[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const fp = path.join(sessionsDir, entry.name);
    try {
      const data = JSON.parse(
        fs.readFileSync(fp, "utf-8"),
      ) as Partial<SessionFile>;
      sessions.push({
        name: data.name ?? entry.name.replace(/\.json$/, ""),
        provider: data.provider,
        model: data.model,
        messageCount: data.messageCount ?? data.messages?.length ?? 0,
        savedAt: data.savedAt ?? new Date(fs.statSync(fp).mtime).toISOString(),
        createdAt: data.createdAt ?? data.savedAt ?? "",
      });
    } catch {
      // skip corrupt files silently
    }
  }

  // Newest saved first
  return sessions.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
  );
}

/**
 * Delete a named session. Throws if not found.
 */
export function deleteSession(name: string): void {
  const fp = filePath(name);
  if (!fs.existsSync(fp)) {
    throw new Error(`Session "${name}" not found.`);
  }
  fs.unlinkSync(fp);
}

/**
 * Rename a session. Throws if source not found or destination already exists.
 */
export function renameSession(oldName: string, newName: string): void {
  const src = filePath(oldName);
  const dst = filePath(newName);

  if (!fs.existsSync(src)) throw new Error(`Session "${oldName}" not found.`);
  if (fs.existsSync(dst))
    throw new Error(`Session "${newName}" already exists.`);

  // Update the name field inside the file before moving
  const data = loadSession(oldName);
  data.name = newName;
  fs.writeFileSync(dst, JSON.stringify(data, null, 2), "utf-8");
  fs.unlinkSync(src);
}

export function sessionExists(name: string): boolean {
  try {
    return fs.existsSync(filePath(name));
  } catch {
    return false;
  }
}
