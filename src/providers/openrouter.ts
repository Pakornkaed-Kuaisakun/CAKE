// src/providers/openrouter.ts
//
// OpenRouter provider — OpenAI-compatible API with 429 retry + fallback.
//
// Thinking / Reasoning:
//   OpenRouter forwards native thinking params to the underlying model.
//   For Claude models via OpenRouter: passes through extended thinking config.
//   For o-series via OpenRouter: passes reasoning_effort.
//   For DeepSeek-R1 / other reasoning models: passes through as-is.
//
// Batch API (free-model compatible):
//   OpenRouter does NOT natively support batch endpoints.
//   We implement a local client-side batch runner: fire N requests in
//   controlled concurrency (default 5 at a time) to stay within rate limits.
//   This gives a "batch-like" experience without the 24h async window.
//
// Prompt caching:
//   DeepSeek V3/R1: automatic, shows in cached_tokens.
//   Claude models via OpenRouter: automatic, same as native Claude.
//   Others: no caching, cachedTokens = 0.

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

// ── Constants ─────────────────────────────────────────────────────────────────

const FREE_FALLBACKS = [
  "openai/gpt-oss-20b:free",
  "deepseek/deepseek-v4-flash:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "google/gemma-4-26b-a4b-it:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
];

const DEFAULT_MAIN =
  process.env.OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function is429(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) return err.status === 429;
  if (err instanceof Error) return err.message.includes("429");
  return false;
}

function extractCached(usage: any): number {
  return (
    usage?.prompt_tokens_details?.cached_tokens ??
    usage?.cache_read_input_tokens ??
    0
  );
}

/**
 * Detect if a model is an o-series reasoning model (via OpenRouter).
 * OpenRouter model IDs look like "openai/o3-mini" or "openai/o1".
 */
function isReasoningModel(model: string): boolean {
  const base = model.split("/").pop() ?? model;
  return /^o\d/.test(base);
}

/**
 * Map ThinkingConfig → reasoning_effort for o-series models via OpenRouter.
 */
function toReasoningEffort(
  thinking: NonNullable<ChatOptions["thinking"]>,
): "low" | "medium" | "high" {
  if (thinking.level) return thinking.level;
  const budget = thinking.budgetTokens ?? 0;
  if (budget >= 8192) return "high";
  if (budget >= 2048) return "medium";
  return "low";
}

/**
 * Build extra body fields for thinking/reasoning, depending on the model.
 * OpenRouter passes these through to the underlying provider.
 */
function buildThinkingBody(
  model: string,
  thinking: NonNullable<ChatOptions["thinking"]>,
): Record<string, unknown> {
  if (!thinking.enabled) return {};

  // o-series via OpenRouter
  if (isReasoningModel(model)) {
    return { reasoning_effort: toReasoningEffort(thinking) };
  }

  // Claude models via OpenRouter — pass extended thinking config
  if (model.includes("claude")) {
    const levelMap: Record<string, number> = {
      low: 1024,
      medium: 4096,
      high: 10000,
    };
    const budget =
      thinking.budgetTokens ??
      (thinking.level ? levelMap[thinking.level] : 4096);
    return {
      thinking: { type: "enabled", budget_tokens: Math.max(1024, budget) },
    };
  }

  // DeepSeek-R1 and other reasoning models — no special params needed,
  // they always reason. Return empty to avoid API errors.
  return {};
}

// ── Concurrency-limited batch runner ─────────────────────────────────────────

async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class OpenRouterProvider implements AIProvider, BatchProvider {
  name = "openrouter" as const;
  private client: OpenAI;

  constructor(
    apiKey?: string,
    siteUrl = "http://localhost",
    siteName = "CAKE",
  ) {
    this.client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: apiKey ?? process.env.OPENROUTER_API_KEY ?? "",
      defaultHeaders: {
        "HTTP-Referer": siteUrl,
        "X-Title": siteName,
      },
    });
  }

  private buildMessages(
    messages: Message[],
    systemPrompt?: string,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) out.push({ role: "system", content: systemPrompt });
    for (const m of messages) {
      if (m.role === "system" && !systemPrompt)
        out.push({ role: "system", content: m.content });
      else if (m.role !== "system")
        out.push({ role: m.role, content: m.content });
    }
    return out;
  }

  private buildChain(model: string): string[] {
    return [model, ...FREE_FALLBACKS.filter((m) => m !== model)];
  }

  // ── chat ──────────────────────────────────────────────────────────────────

  async chat(
    messages: Message[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const {
      model = DEFAULT_MAIN,
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
      signal,
      thinking,
    } = options;

    const msgs = this.buildMessages(messages, systemPrompt);
    const chain = this.buildChain(model);
    const thinkingBody = thinking ? buildThinkingBody(model, thinking) : {};
    const useReasoning =
      thinking?.enabled &&
      isReasoningModel(model) &&
      "reasoning_effort" in thinkingBody;
    let lastErr: unknown;

    for (let i = 0; i < chain.length; i++) {
      const m = chain[i];
      try {
        const requestBody: any = {
          model: m,
          messages: msgs,
          max_tokens: maxTokens,
          ...thinkingBody,
        };

        // DeepSeek/reasoning models require include_reasoning to not strip reasoning tokens
        const isReasoning =
          m.includes("deepseek") ||
          m.includes("r1") ||
          m.includes("qwq") ||
          isReasoningModel(m);

        if (isReasoning) {
          requestBody.include_reasoning = true;
        } else {
          requestBody.temperature = temperature;
        }

        const response = await this.client.chat.completions.create(
          requestBody,
          { signal },
        );

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
        const cached = extractCached(response.usage);
        const reasoning =
          (response.usage?.completion_tokens_details as any)
            ?.reasoning_tokens ?? 0;

        if (i > 0)
          console.warn(
            `[openrouter] fell back to "${m}" after 429 on "${chain[0]}"`,
          );

        return {
          text,
          thinking: thinkingText || undefined,
          usage: {
            inputTokens: inp,
            outputTokens: out,
            cachedTokens: cached,
            thinkingTokens: reasoning > 0 ? reasoning : undefined,
            costUsd: 0,
          },
        };
      } catch (err) {
        lastErr = err;
        if (!is429(err)) throw err;
        const wait = 1500 * (i + 1);
        console.warn(
          `[openrouter] 429 on "${m}" — trying next model in ${wait}ms`,
        );
        await sleep(wait);
      }
    }

    throw new Error(
      `[openrouter] All models rate-limited (429).\n` +
        `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  // ── stream ────────────────────────────────────────────────────────────────

  async stream(
    messages: Message[],
    options: ChatOptions,
    onChunk: StreamChunkCallback,
  ): Promise<ChatResult> {
    const {
      model = DEFAULT_MAIN,
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
      signal,
      thinking,
    } = options;

    // Reasoning models (o-series) don't support streaming — fall back to chat()
    if (thinking?.enabled && isReasoningModel(model)) {
      const result = await this.chat(messages, options);
      onChunk(result.text);
      return result;
    }

    const msgs = this.buildMessages(messages, systemPrompt);
    const chain = this.buildChain(model);
    const thinkingBody = thinking ? buildThinkingBody(model, thinking) : {};
    let lastErr: unknown;

    for (let i = 0; i < chain.length; i++) {
      const m = chain[i];
      try {
        const isReasoning =
          m.includes("deepseek") ||
          m.includes("r1") ||
          m.includes("qwq") ||
          isReasoningModel(m);

        const requestBody: any = {
          model: m,
          messages: msgs,
          max_tokens: maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          ...thinkingBody,
        };

        if (isReasoning) {
          requestBody.include_reasoning = true;
        } else {
          requestBody.temperature = temperature;
        }

        const streamResponse: any = await this.client.chat.completions.create(
          requestBody,
          { signal },
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
            cached = extractCached(chunk.usage);
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

        if (i > 0) console.warn(`[openrouter] streamed with fallback "${m}"`);
        return {
          text,
          thinking: thinkingText || undefined,
          usage: {
            inputTokens: inp,
            outputTokens: out,
            cachedTokens: cached,
            costUsd: 0,
          },
        };
      } catch (err) {
        lastErr = err;
        if (!is429(err)) throw err;
        const wait = 1500 * (i + 1);
        console.warn(`[openrouter] 429 on "${m}" (stream) — waiting ${wait}ms`);
        await sleep(wait);
      }
    }

    throw new Error(
      `[openrouter] All models rate-limited (429).\n` +
        `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  // ── Batch API (client-side concurrent runner) ─────────────────────────────

  /**
   * OpenRouter has no native batch endpoint.
   * We implement a client-side batch: fire up to `concurrency` requests
   * at a time with per-request 429 retry, returning results in order.
   *
   * batchId is a client-generated UUID for tracking purposes only.
   */
  async submitBatch(
    requests: BatchRequest[],
    concurrency = 5,
  ): Promise<BatchSubmitResult> {
    const batchId = `or-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Store requests on instance for pollBatch (which runs them synchronously here)
    (this as any)[`_pending_${batchId}`] = { requests, concurrency };

    return {
      batchId,
      status: "pending",
      createdAt: new Date().toISOString(),
      requestCount: requests.length,
      meta: { note: "OpenRouter: client-side concurrent batch (no 24h async)" },
    };
  }

  /**
   * "Polling" for OpenRouter immediately runs the pending requests
   * (since there's no server-side async job).
   */
  async pollBatch(batchId: string): Promise<BatchPollResult> {
    const pending = (this as any)[`_pending_${batchId}`];
    if (!pending) {
      return {
        batchId,
        status: "failed",
        checkedAt: new Date().toISOString(),
      };
    }

    const { requests, concurrency } = pending as {
      requests: BatchRequest[];
      concurrency: number;
    };

    delete (this as any)[`_pending_${batchId}`];

    const tasks = requests.map(
      (req: BatchRequest) => async (): Promise<BatchResponse> => {
        try {
          const result = await this.chat(req.messages, {
            ...req.options,
            model: req.options?.model ?? DEFAULT_MAIN,
          });
          return { customId: req.customId, result };
        } catch (err: any) {
          return {
            customId: req.customId,
            result: null,
            error: err.message ?? "Unknown error",
          };
        }
      },
    );

    const responses = await runConcurrent(tasks, concurrency);

    return {
      batchId,
      status: "completed",
      responses,
      checkedAt: new Date().toISOString(),
      progressPct: 100,
    };
  }

  /**
   * Cancel: just clear the pending batch from memory.
   */
  async cancelBatch(batchId: string): Promise<void> {
    delete (this as any)[`_pending_${batchId}`];
  }

  /**
   * Submit and immediately run (OpenRouter: synchronous concurrent).
   */
  async runBatch(
    requests: BatchRequest[],
    opts: {
      intervalMs?: number;
      timeoutMs?: number;
      concurrency?: number;
    } = {},
  ): Promise<BatchResponse[]> {
    const { concurrency = 5 } = opts as any;
    const { batchId } = await this.submitBatch(requests, concurrency);
    const poll = await this.pollBatch(batchId);
    return poll.responses ?? [];
  }
}
