// src/providers/batch-types.ts
// Shared types for Batch API and Thinking Budget across all providers.

// ── Thinking Budget ───────────────────────────────────────────────────────────

export type ThinkingLevel = "low" | "medium" | "high";

export interface ThinkingConfig {
  /** Enable extended/chain-of-thought thinking */
  enabled: boolean;
  /**
   * Token budget for thinking.
   * Claude: maps to budgetTokens in extendedThinking (min 1024)
   * Gemini: maps to thinkingConfig.thinkingBudget
   * OpenAI: maps to reasoning_effort ("low"/"medium"/"high")
   */
  budgetTokens?: number;
  /** High-level hint — provider will map to native representation */
  level?: ThinkingLevel;
}

// ── Batch API ─────────────────────────────────────────────────────────────────

export interface BatchRequest {
  /** Caller-supplied ID to correlate responses */
  customId: string;
  messages: import("./types.js").Message[];
  options?: import("./types.js").ChatOptions;
}

export type BatchStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface BatchResponse {
  customId: string;
  result: import("./types.js").ChatResult | null;
  error?: string;
}

export interface BatchSubmitResult {
  /** Provider-native batch/job ID */
  batchId: string;
  status: BatchStatus;
  /** ISO timestamp when the batch was created */
  createdAt: string;
  /** Total number of requests in this batch */
  requestCount: number;
  /** Provider-specific metadata */
  meta?: Record<string, unknown>;
}

export interface BatchPollResult {
  batchId: string;
  status: BatchStatus;
  /** Populated once status === "completed" */
  responses?: BatchResponse[];
  /** ISO timestamp of the poll */
  checkedAt: string;
  /** 0-100 rough progress estimate (not always available) */
  progressPct?: number;
}

export interface BatchProvider {
  /**
   * Submit a batch of requests.
   * Returns a batchId you can pass to pollBatch() / cancelBatch().
   */
  submitBatch(requests: BatchRequest[]): Promise<BatchSubmitResult>;

  /**
   * Poll the status of a previously submitted batch.
   * When status === "completed", responses[] is populated.
   */
  pollBatch(batchId: string): Promise<BatchPollResult>;

  /**
   * Cancel a pending / processing batch.
   * No-op if already completed or cancelled.
   */
  cancelBatch(batchId: string): Promise<void>;

  /**
   * Convenience: submit and wait until done, polling every `intervalMs`.
   * Throws if batch fails or is cancelled.
   */
  runBatch(
    requests: BatchRequest[],
    opts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<BatchResponse[]>;
}
