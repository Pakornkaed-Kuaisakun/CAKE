import crypto from "crypto";
import { withTimeout } from "../shared/utils/utils.js";

export type AsyncTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AsyncTaskRecord {
  id: string;
  description: string;
  status: AsyncTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

interface AsyncTaskInternal extends AsyncTaskRecord {
  executor: () => Promise<string>;
}

export interface AsyncExecutionQueueOptions {
  taskTimeoutMs?: number;
}

const DEFAULT_TASK_TIMEOUT_MS = 120_000;

export class AsyncExecutionQueue {
  private tasks: AsyncTaskInternal[] = [];
  private processing = false;
  private taskTimeoutMs: number;

  constructor(options: AsyncExecutionQueueOptions = {}) {
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  }

  enqueue(description: string, executor: () => Promise<string>): string {
    const id = crypto.randomUUID();
    this.tasks.push({
      id,
      description,
      status: "pending",
      createdAt: Date.now(),
      executor,
    });
    void this.processQueue();
    return id;
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || task.status !== "pending") return false;
    task.status = "cancelled";
    return true;
  }

  get(taskId: string): AsyncTaskRecord | undefined {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return undefined;
    const { executor, ...record } = task;
    return record;
  }

  list(): AsyncTaskRecord[] {
    return this.tasks.map(({ executor, ...record }) => record);
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const next = this.tasks.find((t) => t.status === "pending");
        if (!next) break;

        next.status = "running";
        next.startedAt = Date.now();

        try {
          const result = await withTimeout(next.executor(), this.taskTimeoutMs, "Task timeout");
          next.result = result;
          next.status = "completed";
        } catch (err: any) {
          next.error = err?.message ?? String(err);
          next.status = "failed";
        } finally {
          next.completedAt = Date.now();
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

export const asyncExecutionQueue = new AsyncExecutionQueue();
