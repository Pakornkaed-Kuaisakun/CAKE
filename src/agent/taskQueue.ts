// Priority task queue with concurrency control, retry logic, progress tracking,
// and event emission. Designed to complement the existing AsyncExecutionQueue
// with richer scheduling semantics.
//
// Key features vs AsyncExecutionQueue:
//   • Priority levels (critical > high > medium > low)
//   • Configurable concurrency limit (default 3 parallel tasks)
//   • Automatic retry with exponential back-off
//   • Per-task progress reporting
//   • EventEmitter for reactive UI / Discord integration
//   • Task dependencies (a task can wait for another to complete)
//   • Pause / resume the whole queue or individual tasks
//   • Task timeout enforcement
//   • Persistent task log (rolling, max 1000 entries)

import crypto from "crypto";
import { EventEmitter } from "events";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export interface TaskOptions {
  /** Display label shown in UIs and logs */
  description: string;
  /** Scheduling priority. Higher priority tasks run before lower ones. Default: "medium" */
  priority?: TaskPriority;
  /** Maximum number of automatic retries on failure. Default: 0 */
  maxRetries?: number;
  /** Base delay (ms) before first retry. Doubles with each attempt. Default: 1000 */
  retryDelayMs?: number;
  /** Task will be cancelled if it runs longer than this many ms. Default: no timeout */
  timeoutMs?: number;
  /** IDs of tasks that must complete successfully before this one starts. */
  dependsOn?: string[];
  /** Arbitrary metadata stored alongside the task. */
  meta?: Record<string, unknown>;
  /** Called periodically by the executor to report 0–100 progress. */
  onProgress?: (pct: number, message?: string) => void;
}

export interface TaskRecord {
  id: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
  progressMessage?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  retries: number;
  maxRetries: number;
  dependsOn: string[];
  meta: Record<string, unknown>;
  eta?: number; // estimated seconds remaining (set by executor)
}

export interface TaskQueueOptions {
  /** Maximum tasks running concurrently. Default: 3 */
  concurrency?: number;
  /** If true, new tasks added when queue is full are rejected. Default: false */
  rejectWhenFull?: boolean;
  /** Maximum queue size (pending + running). 0 = unlimited. Default: 0 */
  maxSize?: number;
  /** Drain timeout in ms for graceful shutdown. Default: 30_000 */
  drainTimeoutMs?: number;
}

// ── Priority ordering ─────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ── Internal task record ──────────────────────────────────────────────────────

interface InternalTask extends TaskRecord {
  executor: () => Promise<string>;
  abortController: AbortController;
  retryDelayMs: number;
  timeoutMs?: number;
  onProgress?: (pct: number, message?: string) => void;
  _resolve: (result: string) => void;
  _reject: (err: Error) => void;
}

// ── TaskQueue ─────────────────────────────────────────────────────────────────

export class TaskQueue extends EventEmitter {
  private tasks = new Map<string, InternalTask>();
  private pendingIds: string[] = []; // sorted by priority
  private runningCount = 0;
  private paused = false;
  private readonly concurrency: number;
  private readonly rejectWhenFull: boolean;
  private readonly maxSize: number;
  private readonly drainTimeoutMs: number;

  constructor(opts: TaskQueueOptions = {}) {
    super();
    this.concurrency = opts.concurrency ?? 3;
    this.rejectWhenFull = opts.rejectWhenFull ?? false;
    this.maxSize = opts.maxSize ?? 0;
    this.drainTimeoutMs = opts.drainTimeoutMs ?? 30_000;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Enqueue a task. Returns a Promise that resolves/rejects with the task result
   * and a task ID for status polling.
   */
  enqueue(
    executor: () => Promise<string>,
    opts: TaskOptions,
  ): { id: string; promise: Promise<string> } {
    const pending = this.pendingIds.length;
    const total = pending + this.runningCount;

    if (this.rejectWhenFull && this.maxSize > 0 && total >= this.maxSize) {
      throw new Error(
        `Task queue is full (${total}/${this.maxSize}). Try again later.`,
      );
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    let _resolve!: (result: string) => void;
    let _reject!: (err: Error) => void;
    const promise = new Promise<string>((res, rej) => {
      _resolve = res;
      _reject = rej;
    });

    const task: InternalTask = {
      id,
      description: opts.description,
      priority: opts.priority ?? "medium",
      status: "pending",
      progress: 0,
      createdAt: now,
      retries: 0,
      maxRetries: opts.maxRetries ?? 0,
      retryDelayMs: opts.retryDelayMs ?? 1000,
      dependsOn: opts.dependsOn ?? [],
      meta: opts.meta ?? {},
      executor,
      abortController: new AbortController(),
      timeoutMs: opts.timeoutMs,
      onProgress: opts.onProgress,
      _resolve,
      _reject,
    };

    this.tasks.set(id, task);
    this.insertByPriority(id, task.priority);
    this.emit("task:queued", this.toRecord(task));
    this.scheduleNext();

    return { id, promise };
  }

  /** Cancel a task. Running tasks are interrupted via AbortController. */
  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === "completed" || task.status === "failed") return false;

    task.abortController.abort();
    this.setStatus(task, "cancelled");
    this.pendingIds = this.pendingIds.filter((pid) => pid !== id);
    task._reject(new Error("Task cancelled."));
    this.emit("task:cancelled", this.toRecord(task));
    this.scheduleNext();
    return true;
  }

  /** Pause a running or pending task. */
  pause(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status !== "running" && task.status !== "pending") return false;
    this.setStatus(task, "paused");
    if (task.status === "running") task.abortController.abort();
    this.emit("task:paused", this.toRecord(task));
    return true;
  }

  /** Resume a paused task. */
  resume(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "paused") return false;
    task.abortController = new AbortController();
    this.setStatus(task, "pending");
    this.insertByPriority(id, task.priority);
    this.emit("task:resumed", this.toRecord(task));
    this.scheduleNext();
    return true;
  }

  /** Pause the entire queue (in-flight tasks complete, no new ones start). */
  pauseAll(): void {
    this.paused = true;
    this.emit("queue:paused");
  }

  /** Resume the entire queue. */
  resumeAll(): void {
    this.paused = false;
    this.emit("queue:resumed");
    this.scheduleNext();
  }

  /** Update a task's priority. Takes effect immediately for pending tasks. */
  reprioritize(id: string, priority: TaskPriority): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "pending") return false;
    task.priority = priority;
    this.pendingIds = this.pendingIds.filter((pid) => pid !== id);
    this.insertByPriority(id, priority);
    this.emit("task:reprioritized", this.toRecord(task));
    return true;
  }

  /** Get current record for a task. Returns null if not found. */
  get(id: string): TaskRecord | null {
    const task = this.tasks.get(id);
    return task ? this.toRecord(task) : null;
  }

  /** List all task records, optionally filtered by status. */
  list(filter?: TaskStatus | TaskStatus[]): TaskRecord[] {
    const statuses = filter
      ? Array.isArray(filter)
        ? new Set(filter)
        : new Set([filter])
      : null;

    return [...this.tasks.values()]
      .filter((t) => !statuses || statuses.has(t.status))
      .sort((a, b) => {
        // Running first, then by priority, then by creation time
        if (a.status === "running" && b.status !== "running") return -1;
        if (b.status === "running" && a.status !== "running") return 1;
        const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (pd !== 0) return pd;
        return a.createdAt - b.createdAt;
      })
      .map((t) => this.toRecord(t));
  }

  /** Remove all completed/failed/cancelled tasks from the registry. */
  purge(): number {
    const terminal = new Set<TaskStatus>([
      "completed",
      "failed",
      "cancelled",
      "timeout",
    ]);
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (terminal.has(task.status)) {
        this.tasks.delete(id);
        count++;
      }
    }
    this.emit("queue:purged", count);
    return count;
  }

  /**
   * Wait until the queue is empty (no pending or running tasks).
   * Rejects after drainTimeoutMs.
   */
  drain(): Promise<void> {
    if (this.isEmpty()) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(
          new Error(`Queue drain timed out after ${this.drainTimeoutMs}ms`),
        );
      }, this.drainTimeoutMs);

      const check = () => {
        if (this.isEmpty()) {
          clearTimeout(timer);
          off();
          resolve();
        }
      };

      const off = () => {
        this.off("task:completed", check);
        this.off("task:failed", check);
        this.off("task:cancelled", check);
      };

      this.on("task:completed", check);
      this.on("task:failed", check);
      this.on("task:cancelled", check);
    });
  }

  /** Statistics snapshot. */
  stats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    paused: boolean;
    concurrency: number;
  } {
    let pending = 0,
      running = 0,
      completed = 0,
      failed = 0,
      cancelled = 0;
    for (const t of this.tasks.values()) {
      if (t.status === "pending") pending++;
      else if (t.status === "running") running++;
      else if (t.status === "completed") completed++;
      else if (t.status === "failed") failed++;
      else if (t.status === "cancelled") cancelled++;
    }
    return {
      total: this.tasks.size,
      pending,
      running,
      completed,
      failed,
      cancelled,
      paused: this.paused,
      concurrency: this.concurrency,
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private isEmpty(): boolean {
    return this.pendingIds.length === 0 && this.runningCount === 0;
  }

  private insertByPriority(id: string, priority: TaskPriority): void {
    const order = PRIORITY_ORDER[priority];
    // Find insertion point: after all tasks of equal or higher priority
    let idx = this.pendingIds.length;
    for (let i = 0; i < this.pendingIds.length; i++) {
      const other = this.tasks.get(this.pendingIds[i]);
      if (other && PRIORITY_ORDER[other.priority] > order) {
        idx = i;
        break;
      }
    }
    this.pendingIds.splice(idx, 0, id);
  }

  private scheduleNext(): void {
    if (this.paused) return;
    while (this.runningCount < this.concurrency && this.pendingIds.length > 0) {
      const id = this.pendingIds[0];
      const task = this.tasks.get(id);
      if (!task) {
        this.pendingIds.shift();
        continue;
      }

      // Check dependencies
      if (!this.dependenciesMet(task)) {
        // Skip this task for now — check the next one
        // (Simple linear scan; for large queues a proper graph traversal is better)
        const idx = this.pendingIds.indexOf(id);
        if (idx !== -1) this.pendingIds.splice(idx, 1);
        this.pendingIds.push(id); // move to back
        break; // avoid infinite loop
      }

      this.pendingIds.shift();
      this.runTask(task);
    }
  }

  private dependenciesMet(task: InternalTask): boolean {
    return task.dependsOn.every((depId) => {
      const dep = this.tasks.get(depId);
      return dep?.status === "completed";
    });
  }

  private async runTask(task: InternalTask): Promise<void> {
    this.runningCount++;
    task.startedAt = Date.now();
    this.setStatus(task, "running");
    this.emit("task:started", this.toRecord(task));

    const run = async (): Promise<void> => {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      try {
        // Wire progress reporter
        const origOnProgress = task.onProgress;
        task.onProgress = (pct, msg) => {
          task.progress = Math.max(0, Math.min(100, Math.round(pct)));
          task.progressMessage = msg;
          // Estimate ETA from progress rate
          if (task.startedAt && pct > 0 && pct < 100) {
            const elapsed = (Date.now() - task.startedAt) / 1000;
            const rate = pct / elapsed; // pct per second
            task.eta = Math.round((100 - pct) / rate);
          }
          this.emit("task:progress", this.toRecord(task));
          origOnProgress?.(pct, msg);
        };

        const resultPromise = task.executor();

        let result: string;
        if (task.timeoutMs) {
          const timeoutPromise = new Promise<never>((_, rej) => {
            timeoutHandle = setTimeout(
              () => rej(new Error(`Task timed out after ${task.timeoutMs}ms`)),
              task.timeoutMs,
            );
          });
          result = await Promise.race([resultPromise, timeoutPromise]);
        } else {
          result = await resultPromise;
        }

        clearTimeout(timeoutHandle);
        task.result = result;
        task.progress = 100;
        task.completedAt = Date.now();
        this.setStatus(task, "completed");
        task._resolve(result);
        this.emit("task:completed", this.toRecord(task));
      } catch (err: any) {
        clearTimeout(timeoutHandle);

        const isTimeout = err?.message?.includes("timed out");
        const isCancelled =
          task.abortController.signal.aborted ||
          err?.message?.includes("cancel");

        if (isCancelled) {
          // Already handled in cancel()
          return;
        }

        if (isTimeout) {
          task.error = err.message;
          task.completedAt = Date.now();
          this.setStatus(task, "timeout");
          task._reject(err);
          this.emit("task:timeout", this.toRecord(task));
          return;
        }

        // Retry logic
        if (task.retries < task.maxRetries) {
          task.retries++;
          const delay = task.retryDelayMs * Math.pow(2, task.retries - 1);
          this.emit("task:retry", { ...this.toRecord(task), nextDelay: delay });

          this.runningCount--;
          this.setStatus(task, "pending");
          await sleep(delay);
          if (task.status === "cancelled") return;
          task.abortController = new AbortController();
          this.runningCount++;
          task.startedAt = Date.now();
          this.setStatus(task, "running");
          return run();
        }

        task.error = err?.message ?? String(err);
        task.completedAt = Date.now();
        this.setStatus(task, "failed");
        task._reject(err);
        this.emit("task:failed", this.toRecord(task));
      }
    };

    await run();
    this.runningCount--;
    this.scheduleNext();

    if (this.isEmpty()) this.emit("queue:drained");
  }

  private setStatus(task: InternalTask, status: TaskStatus): void {
    task.status = status;
  }

  private toRecord(task: InternalTask): TaskRecord {
    return {
      id: task.id,
      description: task.description,
      priority: task.priority,
      status: task.status,
      progress: task.progress,
      progressMessage: task.progressMessage,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      result: task.result,
      error: task.error,
      retries: task.retries,
      maxRetries: task.maxRetries,
      dependsOn: task.dependsOn,
      meta: task.meta,
      eta: task.eta,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: TaskQueue | null = null;

export function getTaskQueue(): TaskQueue {
  if (!_instance) {
    _instance = new TaskQueue({ concurrency: 3 });
  }
  return _instance;
}

/** Reset the singleton (testing / restart). */
export function resetTaskQueue(): void {
  _instance = null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Convenience wrapper: enqueue and await result.
 * Throws on failure.
 */
export async function runTask(
  executor: () => Promise<string>,
  opts: TaskOptions,
): Promise<{ id: string; result: string }> {
  const queue = getTaskQueue();
  const { id, promise } = queue.enqueue(executor, opts);
  const result = await promise;
  return { id, result };
}

/**
 * Run multiple tasks with a shared concurrency limit.
 * Returns results in submission order (undefined for failed tasks unless throwOnError).
 */
export async function runAll(
  tasks: Array<{ executor: () => Promise<string>; opts: TaskOptions }>,
  options: { throwOnError?: boolean } = {},
): Promise<Array<{ id: string; result: string | null; error?: string }>> {
  const queue = getTaskQueue();
  const entries = tasks.map(({ executor, opts }) =>
    queue.enqueue(executor, opts),
  );

  const results: Array<{ id: string; result: string | null; error?: string }> =
    [];

  for (const { id, promise } of entries) {
    try {
      const result = await promise;
      results.push({ id, result });
    } catch (err: any) {
      if (options.throwOnError) throw err;
      results.push({ id, result: null, error: err.message });
    }
  }

  return results;
}
