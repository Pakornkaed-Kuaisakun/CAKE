// src/cli/hints/itemHintReaders.ts
//
// Pure (non-React) functions that read local data files and return
// ItemHint[] for the autocomplete popup.
//
// Each reader follows the same contract:
//   • Returns []  if the file doesn't exist or can't be parsed.
//   • Never throws — autocomplete failure must never crash the CLI.
//   • id   → the exact string to insert into the command line.
//   • preview → short human-readable label shown next to the id.

import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";
import { getTaskQueue } from "../../agent/taskQueue.js";

// ── Shared type ───────────────────────────────────────────────────────────────

export interface ItemHint {
  id: string;
  preview: string;
}

// ── Todo ──────────────────────────────────────────────────────────────────────
// File: ~/.cake/todos.json
// Shape: Array<{ id, title, done, priority, dueDate }>

const TODO_FILE = path.join(CAKE_DIR, "todos.json");

export function readTodoHints(): ItemHint[] {
  try {
    if (!fs.existsSync(TODO_FILE)) return [];
    const todos: any[] = JSON.parse(fs.readFileSync(TODO_FILE, "utf-8"));
    return todos
      .filter((t) => !t.done) // only pending todos are worth deleting
      .map((t) => ({
        id: String(t.id ?? ""),
        preview: [
          t.title ? String(t.title).slice(0, 55) : "(no title)",
          t.priority ? `[${t.priority}]` : "",
          t.dueDate ? `due:${t.dueDate}` : "",
        ]
          .filter(Boolean)
          .join("  "),
      }))
      .filter((h) => h.id);
  } catch {
    return [];
  }
}

// ── Cron ──────────────────────────────────────────────────────────────────────
// File: ~/.cake/cron-jobs.json
// Shape: Array<{ id, name, cronExpression, taskDescription, enabled }>

const CRON_FILE = path.join(CAKE_DIR, "cron-jobs.json");

export function readCronHints(): ItemHint[] {
  try {
    if (!fs.existsSync(CRON_FILE)) return [];
    const jobs: any[] = JSON.parse(fs.readFileSync(CRON_FILE, "utf-8"));
    return jobs
      .map((j) => ({
        id: String(j.id ?? ""),
        preview: [
          j.name ? String(j.name).slice(0, 35) : "(unnamed)",
          j.cronExpression ? `⏰ ${j.cronExpression}` : "",
          j.enabled === false ? "[disabled]" : "",
        ]
          .filter(Boolean)
          .join("  "),
      }))
      .filter((h) => h.id);
  } catch {
    return [];
  }
}

// ── Calendar ──────────────────────────────────────────────────────────────────
// File: ~/.cake/cache/calendar-events.json   (written by handleCalendarList)
// Shape: Array<{ id, summary, start, end }>
//
// Calendar IDs are 26-char alphanumeric strings (Google Calendar format).
// We cache the last fetched event list so the autocomplete never needs
// a live API call.

const CALENDAR_CACHE = path.join(CAKE_DIR, "cache", "calendar-events.json");

export function readCalendarHints(): ItemHint[] {
  try {
    if (!fs.existsSync(CALENDAR_CACHE)) return [];
    const events: any[] = JSON.parse(fs.readFileSync(CALENDAR_CACHE, "utf-8"));
    return events
      .map((e) => {
        const start = e.start
          ? new Date(e.start).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        return {
          id: String(e.id ?? ""),
          preview: [
            e.summary ? String(e.summary).slice(0, 40) : "(no title)",
            start,
          ]
            .filter(Boolean)
            .join("  "),
        };
      })
      .filter((h) => h.id);
  } catch {
    return [];
  }
}

// ── Async queue hints ───────────────────────────────────────────────────────
// Reads live background task IDs from the agent's asyncExecutionQueue.
// Returns all tasks (pending/running/completed) but previews include status.
import { asyncExecutionQueue } from "../../agent/asyncExecution.js";

export function readAsyncHints(): ItemHint[] {
  try {
    const tasks = asyncExecutionQueue.list();
    return tasks
      .map((t) => ({
        id: String(t.id ?? ""),
        preview: `${t.status}${t.description ? ` • ${String(t.description).slice(0, 60)}` : ""}`,
      }))
      .filter((h) => h.id);
  } catch {
    return [];
  }
}

export function readAsyncPendingHints(): ItemHint[] {
  try {
    const tasks = asyncExecutionQueue
      .list()
      .filter((t) => t.status === "pending");
    return tasks
      .map((t) => ({
        id: String(t.id ?? ""),
        preview: `${t.status}${t.description ? ` • ${String(t.description).slice(0, 60)}` : ""}`,
      }))
      .filter((h) => h.id);
  } catch {
    return [];
  }
}

export function readTqHints(): ItemHint[] {
  try {
    const tasks = getTaskQueue().list();
    return tasks
      .map((t) => ({
        id: t.id,
        preview: `${t.status} [${t.priority}] • ${String(t.description).slice(0, 55)}`,
      }))
      .filter((h) => h.id);
  } catch {
    return [];
  }
}

export function readTqPendingHints(): ItemHint[] {
  try {
    const tasks = getTaskQueue().list(["pending", "paused"]);
    return tasks
      .map((t) => ({
        id: t.id,
        preview: `${t.status} [${t.priority}] • ${String(t.description).slice(0, 55)}`,
      }))
      .filter((h) => h.id);
  } catch {
    return [];
  }
}
