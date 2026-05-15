// src/agent/handlers/session.ts
//
// Handles /session sub-commands called from useAgent.ts.
//
// Sub-commands:
//   /session save <name>          — save current history to a named file
//   /session load <name>          — restore a named session (replaces history)
//   /session list                 — show all saved sessions
//   /session delete <name>        — delete a named session
//   /session rename <old> <new>   — rename a session
//   /session info <name>          — show metadata without loading
//
// This module exports a single dispatch function that the useAgent switch
// statement can call; it returns a plain string suitable for addMsg("system", …).

import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  renameSession,
  sessionExists,
  sessionsDir,
  type SessionFile,
} from "../../modules/sessions/index.js";
import type { Message } from "../../providers/types.js";

// ── Return type ───────────────────────────────────────────────────────────────

export type SessionCommandResult =
  | { kind: "message"; text: string } // show a system message
  | { kind: "load"; session: SessionFile; text: string } // restore history + show message
  | { kind: "error"; text: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function pluralMsg(n: number): string {
  return `${n} message${n !== 1 ? "s" : ""}`;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * @param args   Tokens after "/session" — e.g. ["save", "mywork"]
 * @param messages  Current conversation history (for save)
 * @param providerName  Active provider name (stored as metadata)
 * @param model         Active model (stored as metadata)
 */
export function handleSessionCommand(
  args: string[],
  messages: Message[],
  providerName?: string,
  model?: string,
): SessionCommandResult {
  const sub = args[0]?.toLowerCase();

  // ── /session save <name> ─────────────────────────────────────────────────
  if (sub === "save") {
    const name = args[1];
    if (!name) {
      return {
        kind: "error",
        text: "Usage: /session save <name>\nExample: /session save project-alpha",
      };
    }

    // Filter out system-preamble messages (the welcome banner) — keep real chat
    const toSave = messages.filter(
      (m) => !(m.role === "system" && m.content.includes("CAKE ready")),
    );

    if (toSave.length === 0) {
      return {
        kind: "error",
        text: "Nothing to save — conversation is empty.",
      };
    }

    const overwriting = sessionExists(name);
    const session = saveSession(name, toSave, {
      provider: providerName,
      model,
    });

    return {
      kind: "message",
      text: [
        overwriting
          ? `✅ Session "${name}" updated.`
          : `✅ Session "${name}" saved.`,
        `   ${pluralMsg(session.messageCount)} · ${fmtDate(session.savedAt)}`,
        `   ${sessionsDir}/${name}.json`,
      ].join("\n"),
    };
  }

  // ── /session load <name> ─────────────────────────────────────────────────
  if (sub === "load") {
    const name = args[1];
    if (!name) {
      return {
        kind: "error",
        text: "Usage: /session load <name>\nExample: /session load project-alpha",
      };
    }

    let session: SessionFile;
    try {
      session = loadSession(name);
    } catch (err: any) {
      return { kind: "error", text: `❌ ${err.message}` };
    }

    const provLine = [session.provider, session.model]
      .filter(Boolean)
      .join(" / ");
    return {
      kind: "load",
      session,
      text: [
        `✅ Session "${name}" loaded.`,
        `   ${pluralMsg(session.messageCount)} restored · saved ${fmtDate(session.savedAt)}`,
        provLine ? `   Originally: ${provLine}` : "",
        `   Tip: current provider is unchanged — use /provider to switch.`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  // ── /session list ────────────────────────────────────────────────────────
  if (!sub || sub === "list" || sub === "ls") {
    const all = listSessions();
    if (all.length === 0) {
      return {
        kind: "message",
        text: [
          "No saved sessions yet.",
          `Directory: ${sessionsDir}`,
          "",
          "Save your current conversation with: /session save <name>",
        ].join("\n"),
      };
    }

    const rows = all.map((s, i) => {
      const provStr = [s.provider, s.model].filter(Boolean).join("/");
      return [
        `${String(i + 1).padStart(2)}. ${s.name}`,
        `    ${pluralMsg(s.messageCount)} · saved ${fmtDate(s.savedAt)}`,
        provStr ? `    ${provStr}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    return {
      kind: "message",
      text: [
        `💾 Saved sessions (${all.length}):`,
        `   ${sessionsDir}`,
        "",
        ...rows,
        "",
        "Load with: /session load <name>",
      ].join("\n"),
    };
  }

  // ── /session delete <name> ───────────────────────────────────────────────
  if (sub === "delete" || sub === "rm" || sub === "remove") {
    const name = args[1];
    if (!name) {
      return { kind: "error", text: "Usage: /session delete <name>" };
    }
    try {
      deleteSession(name);
      return { kind: "message", text: `🗑️  Session "${name}" deleted.` };
    } catch (err: any) {
      return { kind: "error", text: `❌ ${err.message}` };
    }
  }

  // ── /session rename <old> <new> ──────────────────────────────────────────
  if (sub === "rename" || sub === "mv") {
    const [, oldName, newName] = args;
    if (!oldName || !newName) {
      return {
        kind: "error",
        text: "Usage: /session rename <old-name> <new-name>",
      };
    }
    try {
      renameSession(oldName, newName);
      return {
        kind: "message",
        text: `✅ Session renamed: "${oldName}" → "${newName}"`,
      };
    } catch (err: any) {
      return { kind: "error", text: `❌ ${err.message}` };
    }
  }

  // ── /session info <name> ─────────────────────────────────────────────────
  if (sub === "info" || sub === "show") {
    const name = args[1];
    if (!name) {
      return { kind: "error", text: "Usage: /session info <name>" };
    }
    let session: SessionFile;
    try {
      session = loadSession(name);
    } catch (err: any) {
      return { kind: "error", text: `❌ ${err.message}` };
    }

    // Show a preview of the last few messages without loading them into the agent
    const preview = session.messages
      .slice(-4)
      .map((m) => {
        const role = m.role.padEnd(9);
        const snippet = m.content.replace(/\s+/g, " ").slice(0, 80);
        return `  ${role} ${snippet}${m.content.length > 80 ? "…" : ""}`;
      })
      .join("\n");

    return {
      kind: "message",
      text: [
        `📋 Session: ${session.name}`,
        `   Messages : ${pluralMsg(session.messageCount)}`,
        `   Saved    : ${fmtDate(session.savedAt)}`,
        `   Created  : ${fmtDate(session.createdAt)}`,
        session.provider ? `   Provider : ${session.provider}` : "",
        session.model ? `   Model    : ${session.model}` : "",
        "",
        "Last messages:",
        preview,
      ]
        .filter((l) => l !== "")
        .join("\n"),
    };
  }

  // ── Unknown sub-command ──────────────────────────────────────────────────
  return {
    kind: "error",
    text: [
      `Unknown sub-command: /session ${sub ?? ""}`,
      "",
      "Available commands:",
      "  /session save <name>          Save current conversation",
      "  /session load <name>          Restore a saved conversation",
      "  /session list                 List all saved sessions",
      "  /session delete <name>        Delete a session",
      "  /session rename <old> <new>   Rename a session",
      "  /session info <name>          Show session metadata + preview",
    ].join("\n"),
  };
}
