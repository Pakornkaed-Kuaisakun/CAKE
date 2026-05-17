// src/providers/openai.ts
//
// Prompt caching: AUTOMATIC on gpt-4o and newer (>= 1024 tokens).
// No code changes required to enable it — OpenAI handles it server-side.
//
// Thinking / Reasoning:
//   Only supported on "o-series" models (o1, o1-mini, o3, o3-mini, o4-mini).
//   Enabled via options.thinking = { enabled: true, level: "low" | "medium" | "high" }
//   Maps to reasoning_effort: "low" | "medium" | "high"
//   budgetTokens is ignored for OpenAI (effort is the only knob).
//   NOTE: o-series models do NOT support temperature or streaming.
//
// Batch API:
//   Upload a JSONL file → POST /v1/files
//   Create batch job   → POST /v1/batches
//   Poll status        → GET  /v1/batches/{id}
//   Retrieve results   → GET  /v1/files/{output_file_id}/content  (JSONL)
//   50% cheaper, 24h window.
//
// Pricing (gpt-4o):
//   Standard input  : $2.50 / M tokens
//   Cached input    : $1.25 / M tokens  (50% saving)
//   Output          : $10.00 / M tokens

import OpenAI from "openai";
import type {
  AIProvider,
  Message,
  ChatOptions,
  ChatResult,
  StreamChunkCallback,
} from "./types.js";
import type {
  BatchRequest,
  BatchResponse,
  BatchSubmitResult,
  BatchPollResult,
  BatchProvider,
} from "./batch-types.js";

// ── Pricing ───────────────────────────────────────────────────────────────────

const MODEL_PRICING: Record<
  string,
  { input: number; cachedInput: number; output: number }
> = {
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4o-2024-11-20": { input: 2.5, cachedInput: 1.25, output: 10.0 },
  o1: { input: 15.0, cachedInput: 7.5, output: 60.0 },
  "o1-mini": { input: 1.1, cachedInput: 0.55, output: 4.4 },
  "o3-mini": { input: 1.1, cachedInput: 0.55, output: 4.4 },
  o3: { input: 10.0, cachedInput: 5.0, output: 40.0 },
  "o4-mini": { input: 1.1, cachedInput: 0.55, output: 4.4 },
};

function getPricing(model: string) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return val;
  }
  return { input: 2.5, cachedInput: 1.25, output: 10.0 };
}

function calcCost(
  model: string,
  inp: number,
  out: number,
  cached: number,
): number {
  const p = getPricing(model);
  const M = 1_000_000;
  const standardInput = Math.max(0, inp - cached);
  return (
    (standardInput * p.input) / M +
    (cached * p.cachedInput) / M +
    (out * p.output) / M
  );
}

// ── Thinking / Reasoning helpers ──────────────────────────────────────────────

/** Returns true if model supports reasoning_effort (o-series) */
function isReasoningModel(model: string): boolean {
  return /^o\d/.test(model); // o1, o1-mini, o3, o3-mini, o4-mini, etc.
}

/** Map ThinkingConfig → reasoning_effort string */
function toReasoningEffort(
  thinking: NonNullable<ChatOptions["thinking"]>,
): "low" | "medium" | "high" {
  if (!thinking.enabled) return "low";
  if (thinking.level) return thinking.level;
  // Map budgetTokens to effort level heuristically
  const budget = thinking.budgetTokens ?? 0;
  if (budget >= 8192) return "high";
  if (budget >= 2048) return "medium";
  return "low";
}

// ── Batch helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function mapBatchStatus(
  apiStatus: string,
): import("./batch-types.js").BatchStatus {
  const map: Record<string, import("./batch-types.js").BatchStatus> = {
    validating: "pending",
    failed: "failed",
    in_progress: "processing",
    finalizing: "processing",
    completed: "completed",
    expired: "expired",
    cancelling: "processing",
    cancelled: "cancelled",
  };
  return map[apiStatus] ?? "pending";
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class OpenAIProvider implements AIProvider, BatchProvider {
  name = "openai" as const;
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  // ── chat ──────────────────────────────────────────────────────────────────

  async chat(
    messages: Message[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const {
      model = "gpt-4o",
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
      thinking,
    } = options;

    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt)
      allMessages.push({ role: "system", content: systemPrompt });
    for (const m of messages) {
      if (m.role === "system" && !systemPrompt)
        allMessages.push({ role: "system", content: m.content });
      else if (m.role !== "system")
        allMessages.push({ role: m.role, content: m.content });
    }

    const useReasoning = thinking?.enabled && isReasoningModel(model);
    const reasoningEffort = useReasoning
      ? toReasoningEffort(thinking!)
      : undefined;

    const requestBody: any = {
      model,
      messages: allMessages,
      max_tokens: maxTokens,
    };

    if (useReasoning && reasoningEffort) {
      // o-series: use reasoning_effort, NOT temperature
      requestBody.reasoning_effort = reasoningEffort;
    } else {
      requestBody.temperature = temperature;
    }

    const response = await this.client.chat.completions.create(requestBody, {
      signal: options.signal,
    });

    const rawText = response.choices[0]?.message?.content ?? "";
    const thinkingText =
      (response.choices[0]?.message as any)?.reasoning ??
      (response.choices[0]?.message as any)?.reasoning_content ??
      "";

    let text = rawText;
    if (thinkingText && thinking?.enabled) {
      text = `<think>\n${thinkingText}\n</think>\n\n${rawText}`;
    } else if (!text && thinkingText) {
      text = `<think>\n${thinkingText}\n</think>`;
    }
    const inp = response.usage?.prompt_tokens ?? 0;
    const out = response.usage?.completion_tokens ?? 0;
    const cached =
      (response.usage?.prompt_tokens_details as any)?.cached_tokens ?? 0;
    const reasoningTokens =
      (response.usage?.completion_tokens_details as any)?.reasoning_tokens ?? 0;

    return {
      text,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        cachedTokens: cached,
        thinkingTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
        costUsd: calcCost(model, inp, out, cached),
      },
    };
  }

  // ── stream ────────────────────────────────────────────────────────────────

  async stream(
    messages: Message[],
    options: ChatOptions,
    onChunk: StreamChunkCallback,
  ): Promise<ChatResult> {
    const {
      model = "gpt-4o",
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
      thinking,
    } = options;

    // o-series models don't support streaming
    if (thinking?.enabled && isReasoningModel(model)) {
      const result = await this.chat(messages, options);
      onChunk(result.text);
      return result;
    }

    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt)
      allMessages.push({ role: "system", content: systemPrompt });
    for (const m of messages) {
      if (m.role === "system" && !systemPrompt)
        allMessages.push({ role: "system", content: m.content });
      else if (m.role !== "system")
        allMessages.push({ role: m.role, content: m.content });
    }

    const streamResponse = await this.client.chat.completions.create(
      {
        model,
        messages: allMessages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: options.signal },
    );

    let fullText = "";
    let thinkingText = "";
    let inp = 0;
    let out = 0;
    let cached = 0;
    let startedThinking = false;

    for await (const chunk of streamResponse) {
      const delta = chunk.choices[0]?.delta?.content;
      const reasoningDelta =
        (chunk.choices[0]?.delta as any)?.reasoning ??
        (chunk.choices[0]?.delta as any)?.reasoning_content;

      if (reasoningDelta) {
        thinkingText += reasoningDelta;
        if (thinking?.enabled) {
          if (!startedThinking) {
            startedThinking = true;
            onChunk("<think>\n");
          }
          onChunk(reasoningDelta);
        }
      }

      if (delta) {
        if (startedThinking) {
          startedThinking = false;
          onChunk("\n</think>\n\n");
        }
        fullText += delta;
        onChunk(delta);
      }
      if (chunk.usage) {
        inp = chunk.usage.prompt_tokens ?? 0;
        out = chunk.usage.completion_tokens ?? 0;
        cached = (chunk.usage.prompt_tokens_details as any)?.cached_tokens ?? 0;
      }
    }

    if (startedThinking) {
      onChunk("\n</think>\n");
    }

    let text = fullText;
    if (thinkingText && thinking?.enabled) {
      text = `<think>\n${thinkingText}\n</think>\n\n${fullText}`;
    } else if (!text && thinkingText) {
      text = `<think>\n${thinkingText}\n</think>`;
    }

    return {
      text,
      thinking: thinkingText || undefined,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        cachedTokens: cached,
        costUsd: calcCost(model, inp, out, cached),
      },
    };
  }

  // ── Embeddings ────────────────────────────────────────────────────────────

  async embed(
    text: string,
    model = "text-embedding-3-small",
  ): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model,
      input: text,
    });
    return response.data[0].embedding;
  }

  async listModels(): Promise<string[]> {
    const list = await this.client.models.list();
    return list.data.map((m) => m.id).filter((id) => id.startsWith("gpt"));
  }

  // ── Batch API ─────────────────────────────────────────────────────────────

  /**
   * Submit a batch by uploading a JSONL file, then creating a batch job.
   * Each request maps to one line in the JSONL (OpenAI Batch format).
   */
  async submitBatch(requests: BatchRequest[]): Promise<BatchSubmitResult> {
    const model = requests[0]?.options?.model ?? "gpt-4o";

    // Build JSONL content
    const lines = requests.map((req) => {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      const sysPrompt = req.options?.systemPrompt;
      if (sysPrompt) messages.push({ role: "system", content: sysPrompt });

      for (const m of req.messages) {
        if (m.role === "system" && !sysPrompt)
          messages.push({ role: "system", content: m.content });
        else if (m.role !== "system")
          messages.push({ role: m.role, content: m.content });
      }

      const reqModel = req.options?.model ?? "gpt-4o";
      const thinking = req.options?.thinking;
      const useReasoning = thinking?.enabled && isReasoningModel(reqModel);

      const body: any = {
        model: reqModel,
        messages,
        max_tokens: req.options?.maxTokens ?? 2048,
      };

      if (useReasoning) {
        body.reasoning_effort = toReasoningEffort(thinking!);
      } else {
        body.temperature = req.options?.temperature ?? 0.7;
      }

      return JSON.stringify({
        custom_id: req.customId,
        method: "POST",
        url: "/v1/chat/completions",
        body,
      });
    });

    const jsonlContent = lines.join("\n");

    // Upload JSONL file
    const blob = new Blob([jsonlContent], { type: "application/jsonl" });
    const file = new File([blob], `batch-${Date.now()}.jsonl`, {
      type: "application/jsonl",
    });

    const uploadedFile = await this.client.files.create({
      file,
      purpose: "batch",
    });

    // Create batch job
    const batch = await this.client.batches.create({
      input_file_id: uploadedFile.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    });

    return {
      batchId: batch.id,
      status: mapBatchStatus(batch.status),
      createdAt: new Date(batch.created_at * 1000).toISOString(),
      requestCount: requests.length,
      meta: {
        inputFileId: uploadedFile.id,
        outputFileId: batch.output_file_id,
        errorFileId: batch.error_file_id,
      },
    };
  }

  /**
   * Poll batch status. Downloads and parses JSONL results when completed.
   */
  async pollBatch(batchId: string): Promise<BatchPollResult> {
    const batch = await this.client.batches.retrieve(batchId);
    const status = mapBatchStatus(batch.status);

    if (status !== "completed") {
      const counts = batch.request_counts;
      const total = counts?.total ?? 0;
      const done = (counts?.completed ?? 0) + (counts?.failed ?? 0);
      const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

      return {
        batchId,
        status,
        checkedAt: new Date().toISOString(),
        progressPct,
      };
    }

    const responses: BatchResponse[] = [];

    if (batch.output_file_id) {
      try {
        const fileContent = await this.client.files.content(
          batch.output_file_id,
        );
        const text = await fileContent.text();
        const lines = text.split("\n").filter(Boolean);

        for (const line of lines) {
          const parsed = JSON.parse(line);
          const customId: string = parsed.custom_id;
          const choice = parsed.response?.body?.choices?.[0];
          const usage = parsed.response?.body?.usage;

          if (choice?.message?.content != null) {
            const inp = usage?.prompt_tokens ?? 0;
            const out = usage?.completion_tokens ?? 0;
            const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
            const reqModel = parsed.response?.body?.model ?? "gpt-4o";

            responses.push({
              customId,
              result: {
                text: choice.message.content,
                usage: {
                  inputTokens: inp,
                  outputTokens: out,
                  cachedTokens: cached,
                  costUsd: calcCost(reqModel, inp, out, cached),
                },
              },
            });
          } else {
            responses.push({
              customId,
              result: null,
              error:
                parsed.response?.body?.error?.message ??
                parsed.error?.message ??
                "Unknown error",
            });
          }
        }
      } catch (err: any) {
        return {
          batchId,
          status: "failed",
          checkedAt: new Date().toISOString(),
          responses: [],
        };
      }
    }

    // Also parse error file if present
    if (batch.error_file_id) {
      try {
        const errorContent = await this.client.files.content(
          batch.error_file_id,
        );
        const text = await errorContent.text();
        const lines = text.split("\n").filter(Boolean);
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (!responses.find((r) => r.customId === parsed.custom_id)) {
            responses.push({
              customId: parsed.custom_id,
              result: null,
              error: parsed.error?.message ?? "Batch error",
            });
          }
        }
      } catch {}
    }

    return {
      batchId,
      status: "completed",
      responses,
      checkedAt: new Date().toISOString(),
      progressPct: 100,
    };
  }

  /**
   * Cancel a pending batch.
   */
  async cancelBatch(batchId: string): Promise<void> {
    await this.client.batches.cancel(batchId);
  }

  /**
   * Submit and wait for completion, polling at `intervalMs`.
   */
  async runBatch(
    requests: BatchRequest[],
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<BatchResponse[]> {
    const { intervalMs = 15_000, timeoutMs = 24 * 60 * 60 * 1_000 } = opts;

    const { batchId } = await this.submitBatch(requests);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const poll = await this.pollBatch(batchId);

      if (poll.status === "completed") return poll.responses ?? [];
      if (poll.status === "failed") throw new Error(`Batch ${batchId} failed.`);
      if (poll.status === "cancelled" || poll.status === "expired")
        throw new Error(`Batch ${batchId} was ${poll.status}.`);
    }

    throw new Error(`Batch ${batchId} timed out after ${timeoutMs}ms.`);
  }
}
