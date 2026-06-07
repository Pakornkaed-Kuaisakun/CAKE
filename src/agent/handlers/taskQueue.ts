// src/agent/handlers/taskQueue.ts
//
// Handler for the "task_queue" family of intents.
//
// Commands:
//   tq_add <description> [--priority critical|high|medium|low] [--retries N] [--timeout Ns]
//   tq_list [--status pending|running|completed|failed]
//   tq_status <id>
//   tq_cancel <id>
//   tq_pause [<id>]         — pause one task or the whole queue
//   tq_resume [<id>]        — resume one task or the whole queue
//   tq_retry <id>           — re-enqueue a failed task
//   tq_priority <id> <level>
//   tq_purge                — remove terminal tasks from registry
//   tq_stats                — queue statistics
//   tq_drain                — wait for all tasks to finish (reports when done)

import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";
import {
  getTaskQueue,
  type TaskPriority,
  type TaskStatus,
} from "../taskQueue.js";
import { getFastModel } from "../../providers/utils.js";

import { fmtMs, fmtAge, fmtDate, stripVerb } from "../../shared/utils/utils.js";

const PRIORITY_ICONS: Record<TaskPriority, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
};

const STATUS_ICONS: Record<TaskStatus, string> = {
  running: "▶",
  pending: "⏳",
  paused: "⏸",
  completed: "✅",
  failed: "❌",
  cancelled: "🚫",
  timeout: "⏰",
};

function fmtTask(
  t: ReturnType<ReturnType<typeof getTaskQueue>["get"]>,
): string {
  if (!t) return "(not found)";
  const age = fmtAge(t.createdAt);
  const pbar =
    t.status === "running" || t.status === "paused"
      ? ` [${Math.round(t.progress)}%${t.eta ? ` ~${t.eta}s` : ""}]`
      : t.status === "completed"
        ? " [100%]"
        : "";
  const retry = t.retries > 0 ? ` retries:${t.retries}/${t.maxRetries}` : "";
  const deps = t.dependsOn.length > 0 ? ` deps:${t.dependsOn.length}` : "";
  return (
    `${STATUS_ICONS[t.status]} ${PRIORITY_ICONS[t.priority]} [${t.id.slice(0, 8)}] ${t.description}${pbar}\n` +
    `   status: ${t.status} · created ${age}${retry}${deps}` +
    (t.error ? `\n   error: ${t.error}` : "") +
    (t.result && t.status === "completed"
      ? `\n   result: ${t.result.slice(0, 80)}${t.result.length > 80 ? "…" : ""}`
      : "") +
    (t.progressMessage ? `\n   note: ${t.progressMessage}` : "")
  );
}

// ── tq_add ────────────────────────────────────────────────────────────────────

export async function handleTqAdd(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["tq_add", "task_queue_add", "tq add"]);

  if (!raw) {
    return text(
      "Usage: tq_add <description> [--priority critical|high|medium|low] [--retries N] [--timeout Ns]\n" +
        "Example: tq_add Sync database --priority high --retries 3 --timeout 60s",
    );
  }

  // Parse flags
  const priorityMatch = raw.match(/--priority\s+(critical|high|medium|low)/i);
  const retriesMatch = raw.match(/--retries\s+(\d+)/i);
  const timeoutMatch = raw.match(/--timeout\s+(\d+)(ms|s|m)?/i);
  const depsMatch = raw.match(/--after\s+([\w,-]+)/i);

  const priority =
    (priorityMatch?.[1]?.toLowerCase() as TaskPriority) ?? "medium";
  const maxRetries = retriesMatch ? parseInt(retriesMatch[1], 10) : 0;

  let timeoutMs: number | undefined;
  if (timeoutMatch) {
    const val = parseInt(timeoutMatch[1], 10);
    const unit = timeoutMatch[2]?.toLowerCase() ?? "s";
    timeoutMs = unit === "ms" ? val : unit === "m" ? val * 60_000 : val * 1_000;
  }

  const dependsOn = depsMatch
    ? depsMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const description = raw
    .replace(/--priority\s+\S+/i, "")
    .replace(/--retries\s+\d+/i, "")
    .replace(/--timeout\s+\d+(ms|s|m)?/i, "")
    .replace(/--after\s+[\w,-]+/i, "")
    .trim();

  if (!description) {
    return text("Please provide a task description.");
  }

  const queue = getTaskQueue();
  const fastModel = model ?? getFastModel(provider.name);

  const { id } = queue.enqueue(
    async () => {
      const result = await provider.chat(
        [{ role: "user", content: description }],
        { model: fastModel, maxTokens: 800 },
      );
      return result.text;
    },
    {
      description,
      priority,
      maxRetries,
      timeoutMs,
      dependsOn,
    },
  );

  const task = queue.get(id)!;
  return text(
    `✅ Task queued\n` +
      `   ID       : ${id}\n` +
      `   Priority : ${PRIORITY_ICONS[priority]} ${priority}\n` +
      `   Retries  : ${maxRetries}\n` +
      (timeoutMs ? `   Timeout  : ${fmtMs(timeoutMs)}\n` : "") +
      (dependsOn.length ? `   Depends  : ${dependsOn.join(", ")}\n` : "") +
      `\nCheck with: tq_status ${id}`,
  );
}

// ── tq_list ───────────────────────────────────────────────────────────────────

export async function handleTqList(
  _provider: AIProvider,
  input: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["tq_list", "tq list"]).toLowerCase();

  const validStatuses: TaskStatus[] = [
    "pending",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "timeout",
  ];

  let filter: TaskStatus | TaskStatus[] | undefined;
  const statusMatch = raw.match(/--status\s+(\S+)/);
  if (statusMatch) {
    const s = statusMatch[1] as TaskStatus;
    if (validStatuses.includes(s)) filter = s;
  }

  const queue = getTaskQueue();
  const tasks = queue.list(filter);

  if (tasks.length === 0) {
    return text(
      filter ? `No ${filter} tasks in queue.` : "Task queue is empty.",
    );
  }

  const grouped: Partial<Record<TaskStatus, typeof tasks>> = {};
  for (const t of tasks) {
    (grouped[t.status] ??= []).push(t);
  }

  const sections: string[] = [];
  const order: TaskStatus[] = [
    "running",
    "paused",
    "pending",
    "failed",
    "timeout",
    "completed",
    "cancelled",
  ];

  for (const s of order) {
    const grp = grouped[s];
    if (!grp?.length) continue;
    sections.push(
      `── ${s.toUpperCase()} (${grp.length}) ──────────────────────────`,
      ...grp.map(fmtTask),
    );
  }

  const stats = queue.stats();
  const header = `[TASK QUEUE] ${tasks.length} task${tasks.length !== 1 ? "s" : ""} · ${stats.running} running · ${stats.pending} pending · concurrency: ${stats.concurrency}${stats.paused ? " · PAUSED" : ""}`;

  return text([header, "", ...sections].join("\n"));
}

// ── tq_status ─────────────────────────────────────────────────────────────────

export async function handleTqStatus(
  _provider: AIProvider,
  input: string,
): Promise<ChatResult> {
  const id = stripVerb(input, ["tq_status", "tq status"]);
  if (!id) return text("Usage: tq_status <task-id>");

  const queue = getTaskQueue();

  // Allow short (8-char) prefix matching
  const allTasks = queue.list();
  const task = allTasks.find((t) => t.id === id || t.id.startsWith(id));

  if (!task)
    return text(`Task not found: ${id}\nRun tq_list to see all tasks.`);

  const lines = [
    `[TASK] ${STATUS_ICONS[task.status]} ${task.description}`,
    "─".repeat(50),
    `  ID         : ${task.id}`,
    `  Status     : ${task.status}`,
    `  Priority   : ${PRIORITY_ICONS[task.priority]} ${task.priority}`,
    `  Progress   : ${task.progress}%${task.progressMessage ? ` — ${task.progressMessage}` : ""}`,
    `  Created    : ${fmtDate(String(task.createdAt))} (${fmtAge(task.createdAt)})`,
    task.startedAt ? `  Started    : ${fmtDate(String(task.startedAt))}` : "",
    task.completedAt
      ? `  Finished   : ${fmtDate(String(task.completedAt))}`
      : "",
    task.startedAt && task.completedAt
      ? `  Duration   : ${fmtMs(task.completedAt - task.startedAt)}`
      : "",
    task.eta ? `  ETA        : ~${task.eta}s` : "",
    `  Retries    : ${task.retries}/${task.maxRetries}`,
    task.dependsOn.length
      ? `  Depends on : ${task.dependsOn.map((d) => d.slice(0, 8)).join(", ")}`
      : "",
    task.error ? `  Error      : ${task.error}` : "",
    task.result
      ? `  Result     :\n${task.result
          .split("\n")
          .slice(0, 8)
          .map((l) => `    ${l}`)
          .join("\n")}${task.result.split("\n").length > 8 ? "\n    …" : ""}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return text(lines);
}

// ── tq_cancel ─────────────────────────────────────────────────────────────────

export async function handleTqCancel(
  _provider: AIProvider,
  input: string,
): Promise<ChatResult> {
  const id = stripVerb(input, ["tq_cancel", "tq cancel"]);
  if (!id) return text("Usage: tq_cancel <task-id>");

  const queue = getTaskQueue();
  const allTasks = queue.list();
  const task = allTasks.find((t) => t.id === id || t.id.startsWith(id));
  if (!task) return text(`Task not found: ${id}`);

  const ok = queue.cancel(task.id);
  return text(
    ok
      ? `🚫 Task cancelled: "${task.description}" [${task.id.slice(0, 8)}]`
      : `Cannot cancel task in status "${task.status}".`,
  );
}

// ── tq_pause ──────────────────────────────────────────────────────────────────

export async function handleTqPause(
  _provider: AIProvider,
  input: string,
): Promise<ChatResult> {
  const id = stripVerb(input, ["tq_pause", "tq pause"]);
  const queue = getTaskQueue();

  if (!id) {
    queue.pauseAll();
    return text("⏸ Queue paused. No new tasks will start until resumed.");
  }

  const allTasks = queue.list();
  const task = allTasks.find((t) => t.id === id || t.id.startsWith(id));
  if (!task) return text(`Task not found: ${id}`);

  const ok = queue.pause(task.id);
  return text(
    ok
      ? `⏸ Task paused: "${task.description}" [${task.id.slice(0, 8)}]`
      : `Cannot pause task in status "${task.status}".`,
  );
}

// ── tq_resume ─────────────────────────────────────────────────────────────────

export async function handleTqResume(
  _provider: AIProvider,
  input: string,
): Promise<ChatResult> {
  const id = stripVerb(input, ["tq_resume", "tq resume"]);
  const queue = getTaskQueue();

  if (!id) {
    queue.resumeAll();
    return text("▶ Queue resumed.");
  }

  const allTasks = queue.list();
  const task = allTasks.find((t) => t.id === id || t.id.startsWith(id));
  if (!task) return text(`Task not found: ${id}`);

  const ok = queue.resume(task.id);
  return text(
    ok
      ? `▶ Task resumed: "${task.description}" [${task.id.slice(0, 8)}]`
      : `Cannot resume task in status "${task.status}".`,
  );
}

// ── tq_retry ──────────────────────────────────────────────────────────────────

export async function handleTqRetry(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const id = stripVerb(input, ["tq_retry", "tq retry"]);
  if (!id) return text("Usage: tq_retry <task-id>");

  const queue = getTaskQueue();
  const allTasks = queue.list();
  const task = allTasks.find((t) => t.id === id || t.id.startsWith(id));
  if (!task) return text(`Task not found: ${id}`);

  if (
    task.status !== "failed" &&
    task.status !== "timeout" &&
    task.status !== "cancelled"
  ) {
    return text(
      `Cannot retry task in status "${task.status}". Only failed/timeout/cancelled tasks can be retried.`,
    );
  }

  const fastModel = model ?? getFastModel(provider.name);

  const { id: newId } = queue.enqueue(
    async () => {
      const result = await provider.chat(
        [{ role: "user", content: task.description }],
        { model: fastModel, maxTokens: 800 },
      );
      return result.text;
    },
    {
      description: task.description,
      priority: task.priority,
      maxRetries: task.maxRetries,
      dependsOn: task.dependsOn,
      meta: { ...task.meta, retriedFrom: task.id },
    },
  );

  return text(
    `🔄 Retried task\n` +
      `   Original : ${task.id.slice(0, 8)}\n` +
      `   New ID   : ${newId}\n` +
      `   Task     : "${task.description}"`,
  );
}

// ── tq_priority ───────────────────────────────────────────────────────────────

export async function handleTqPriority(
  _provider: AIProvider,
  input: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["tq_priority", "tq priority"]);
  const parts = raw.split(/\s+/);
  if (parts.length < 2) {
    return text("Usage: tq_priority <task-id> <critical|high|medium|low>");
  }

  const [idPrefix, levelRaw] = parts;
  const level = levelRaw?.toLowerCase() as TaskPriority;

  if (!["critical", "high", "medium", "low"].includes(level)) {
    return text(
      `Invalid priority "${levelRaw}". Use: critical | high | medium | low`,
    );
  }

  const queue = getTaskQueue();
  const allTasks = queue.list();
  const task = allTasks.find(
    (t) => t.id === idPrefix || t.id.startsWith(idPrefix),
  );
  if (!task) return text(`Task not found: ${idPrefix}`);

  const ok = queue.reprioritize(task.id, level);
  return text(
    ok
      ? `✅ Priority updated: "${task.description}" → ${PRIORITY_ICONS[level]} ${level}`
      : `Cannot reprioritize task in status "${task.status}". Only pending tasks can be reprioritized.`,
  );
}

// ── tq_purge ──────────────────────────────────────────────────────────────────

export async function handleTqPurge(
  _provider: AIProvider,
  _input: string,
): Promise<ChatResult> {
  const queue = getTaskQueue();
  const count = queue.purge();
  return text(
    count > 0
      ? `🗑️  Purged ${count} terminal task${count !== 1 ? "s" : ""} from the registry.`
      : "Nothing to purge — no completed/failed/cancelled tasks found.",
  );
}

// ── tq_stats ──────────────────────────────────────────────────────────────────

export async function handleTqStats(
  _provider: AIProvider,
  _input: string,
): Promise<ChatResult> {
  const queue = getTaskQueue();
  const s = queue.stats();

  const bar = (n: number, total: number, width = 20) => {
    if (total === 0) return "░".repeat(width);
    const filled = Math.round((n / total) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
  };

  const total = s.total;
  const lines = [
    "[TASK QUEUE] Statistics",
    "─".repeat(40),
    `  Status     : ${s.paused ? "⏸ PAUSED" : "▶ Running"}`,
    `  Concurrency: ${s.running}/${s.concurrency} slots in use`,
    "",
    `  Total      : ${total}`,
    `  Pending    : ${s.pending.toString().padStart(4)}  ${bar(s.pending, total)}`,
    `  Running    : ${s.running.toString().padStart(4)}  ${bar(s.running, total)}`,
    `  Completed  : ${s.completed.toString().padStart(4)}  ${bar(s.completed, total)}`,
    `  Failed     : ${s.failed.toString().padStart(4)}  ${bar(s.failed, total)}`,
    `  Cancelled  : ${s.cancelled.toString().padStart(4)}  ${bar(s.cancelled, total)}`,
    "",
    "Commands: tq_list · tq_pause · tq_resume · tq_purge",
  ];

  return text(lines.join("\n"));
}

// ── tq_drain ──────────────────────────────────────────────────────────────────

export async function handleTqDrain(
  _provider: AIProvider,
  _input: string,
): Promise<ChatResult> {
  const queue = getTaskQueue();
  const s = queue.stats();

  if (s.pending === 0 && s.running === 0) {
    return text("Queue is already empty — nothing to drain.");
  }

  const count = s.pending + s.running;
  try {
    await queue.drain();
    return text(
      `✅ Queue drained. All ${count} task${count !== 1 ? "s" : ""} finished.`,
    );
  } catch (err: any) {
    return text(
      `⚠️ Drain timed out: ${err.message}\nSome tasks may still be running.`,
    );
  }
}
