// src/providers/claude.ts
//
// Prompt caching: uses explicit cache_control breakpoints.
//
// Strategy — cache up to 4 breakpoints (API limit) in this order:
//   1. System prompt          → always cached (largest static block)
//   2. Last assistant turn    → cache the growing conversation prefix
//
// Pricing (Sonnet 4.6):
//   Standard input  : $3.00 / M tokens
//   Cache write     : $3.75 / M tokens  (1.25×)
//   Cache read      : $0.30 / M tokens  (0.10×)  ← 90% saving
//   Output          : $15.00 / M tokens
//
// Extended Thinking (Claude 3.7+):
//   Enable via options.thinking = { enabled: true, budgetTokens: 2048 }
//   Requires beta header "interleaved-thinking-2025-05-14"
//   min budgetTokens = 1024, max = model's max_tokens
//   Thinking tokens billed at input rate.
//
// Batch API:
//   Endpoint: POST /v1/messages/batches
//   Poll:     GET  /v1/messages/batches/{id}
//   Cancel:   POST /v1/messages/batches/{id}/cancel
//   Results:  GET  /v1/messages/batches/{id}/results  (NDJSON stream)
//   50% cheaper than single requests, up to 24h processing window.

import Anthropic from "@anthropic-ai/sdk";
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
  { input: number; cacheWrite: number; cacheRead: number; output: number }
> = {
  "claude-sonnet-4-6": {
    input: 3.0,
    cacheWrite: 3.75,
    cacheRead: 0.3,
    output: 15.0,
  },
  "claude-opus-4-6": {
    input: 15.0,
    cacheWrite: 18.75,
    cacheRead: 1.5,
    output: 75.0,
  },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    cacheWrite: 1.0,
    cacheRead: 0.08,
    output: 4.0,
  },
  "claude-sonnet-4-5": {
    input: 3.0,
    cacheWrite: 3.75,
    cacheRead: 0.3,
    output: 15.0,
  },
};

function getPricing(model: string) {
  return (
    MODEL_PRICING[model] ?? {
      input: 3.0,
      cacheWrite: 3.75,
      cacheRead: 0.3,
      output: 15.0,
    }
  );
}

function calcCost(
  model: string,
  inp: number,
  out: number,
  cacheWrite: number,
  cacheRead: number,
): number {
  const p = getPricing(model);
  const M = 1_000_000;
  const standardInput = Math.max(0, inp - cacheWrite - cacheRead);
  return (
    (standardInput * p.input) / M +
    (cacheWrite * p.cacheWrite) / M +
    (cacheRead * p.cacheRead) / M +
    (out * p.output) / M
  );
}

// ── Message builders ──────────────────────────────────────────────────────────

type AnthropicMessage = {
  role: "user" | "assistant";
  content:
    | string
    | Array<{
        type: "text";
        text: string;
        cache_control?: { type: "ephemeral" };
      }>;
};

function buildCachedMessages(chatMessages: Message[]): AnthropicMessage[] {
  if (chatMessages.length === 0) return [];

  const result: AnthropicMessage[] = chatMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role === "assistant") {
      const content =
        typeof result[i].content === "string"
          ? (result[i].content as string)
          : "";
      result[i] = {
        role: "assistant",
        content: [
          {
            type: "text",
            text: content,
            cache_control: { type: "ephemeral" },
          },
        ],
      };
      break;
    }
  }

  return result;
}

type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

function buildSystemBlocks(systemText: string): SystemBlock[] {
  if (!systemText.trim()) return [];
  return [
    { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
  ];
}

// ── Thinking helpers ──────────────────────────────────────────────────────────

/**
 * Map a ThinkingConfig to the Anthropic API shape.
 * Extended thinking requires:
 *   - beta header "interleaved-thinking-2025-05-14"
 *   - betas: ["interleaved-thinking-2025-05-14"] in the request
 *   - thinking block in the request body
 *   - temperature = 1 (required by API when thinking is enabled)
 *   - budgetTokens >= 1024
 */
function buildThinkingParam(
  thinking: NonNullable<ChatOptions["thinking"]>,
  maxTokens: number,
): {
  thinking: { type: "enabled"; budget_tokens: number };
  temperature: 1;
} | null {
  if (!thinking.enabled) return null;

  // Map level → token budget if explicit budgetTokens not provided
  const levelMap: Record<string, number> = {
    low: 1024,
    medium: 4096,
    high: 10000,
  };

  const rawBudget =
    thinking.budgetTokens ?? (thinking.level ? levelMap[thinking.level] : 1024);

  // Budget must be >= 1024 and < maxTokens
  const budget = Math.max(1024, Math.min(rawBudget, maxTokens - 1));

  return {
    thinking: { type: "enabled", budget_tokens: budget },
    temperature: 1, // required when thinking is enabled
  };
}

/** Extract text and thinking content blocks from a response */
function extractContent(blocks: any[]): { text: string; thinking: string } {
  let text = "";
  let thinking = "";
  for (const block of blocks) {
    if (block.type === "text") text += block.text;
    if (block.type === "thinking") thinking += block.thinking ?? "";
  }
  return { text, thinking };
}

// ── Batch helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function mapBatchStatus(
  apiStatus: string,
): import("./batch-types.js").BatchStatus {
  const map: Record<string, import("./batch-types.js").BatchStatus> = {
    in_progress: "processing",
    processing: "processing",
    ended: "completed",
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled",
    expired: "expired",
    created: "pending",
  };
  return map[apiStatus] ?? "pending";
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class ClaudeProvider implements AIProvider, BatchProvider {
  name = "claude" as const;
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  // ── chat ──────────────────────────────────────────────────────────────────

  async chat(
    messages: Message[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const {
      model = "claude-sonnet-4-6",
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
      thinking,
    } = options;

    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");
    const systemText =
      systemPrompt ?? systemMessages.map((m) => m.content).join("\n");

    const system = buildSystemBlocks(systemText);
    const builtMessages = buildCachedMessages(chatMessages);

    // Build thinking params if requested
    const thinkingParam = thinking
      ? buildThinkingParam(thinking, maxTokens)
      : null;

    const requestBody: any = {
      model,
      system: system.length > 0 ? system : undefined,
      max_tokens: maxTokens,
      temperature: thinkingParam?.temperature ?? temperature,
      messages: builtMessages,
    };

    if (thinkingParam) {
      requestBody.thinking = thinkingParam.thinking;
      // Extended thinking requires the beta header
      requestBody.betas = ["interleaved-thinking-2025-05-14"];
    }

    const response = await this.client.messages.create(
      requestBody as any,
      {
        signal: options.signal,
        headers: thinkingParam
          ? { "anthropic-beta": "interleaved-thinking-2025-05-14" }
          : undefined,
      } as any,
    );

    const { text, thinking: thinkingText } = extractContent(
      response.content as any[],
    );

    const inp = response.usage?.input_tokens ?? 0;
    const out = response.usage?.output_tokens ?? 0;
    const cacheWrite =
      (response.usage as any)?.cache_creation_input_tokens ?? 0;
    const cacheRead = (response.usage as any)?.cache_read_input_tokens ?? 0;

    return {
      text,
      thinking: thinkingText || undefined,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        cachedTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: calcCost(model, inp, out, cacheWrite, cacheRead),
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
      model = "claude-sonnet-4-6",
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
      thinking,
    } = options;

    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");
    const systemText =
      systemPrompt ?? systemMessages.map((m) => m.content).join("\n");

    const system = buildSystemBlocks(systemText);
    const builtMessages = buildCachedMessages(chatMessages);

    const thinkingParam = thinking
      ? buildThinkingParam(thinking, maxTokens)
      : null;

    const requestBody: any = {
      model,
      system: system.length > 0 ? system : undefined,
      max_tokens: maxTokens,
      temperature: thinkingParam?.temperature ?? temperature,
      messages: builtMessages,
    };

    if (thinkingParam) {
      requestBody.thinking = thinkingParam.thinking;
      requestBody.betas = ["interleaved-thinking-2025-05-14"];
    }

    let fullText = "";
    let thinkingText = "";
    let inp = 0;
    let out = 0;
    let cacheWrite = 0;
    let cacheRead = 0;

    const streamResponse = await this.client.messages.stream(
      requestBody as any,
      {
        signal: options.signal,
        headers: thinkingParam
          ? { "anthropic-beta": "interleaved-thinking-2025-05-14" }
          : undefined,
      } as any,
    );

    for await (const event of streamResponse) {
      if (event.type === "content_block_delta") {
        const deltaType = (event.delta as any).type;

        if (deltaType === "text_delta") {
          // text_delta is ALWAYS visible response text — never thinking content.
          // The SDK emits thinking_delta (not text_delta) for thinking blocks.
          const chunk = (event.delta as any).text as string;
          fullText += chunk;
          onChunk(chunk);
        } else if (deltaType === "thinking_delta") {
          // thinking_delta is ONLY emitted when extended thinking is active.
          thinkingText += (event.delta as any).thinking ?? "";
        }
      }
    }

    const finalMsg = await streamResponse.finalMessage();
    inp = finalMsg.usage?.input_tokens ?? 0;
    out = finalMsg.usage?.output_tokens ?? 0;
    cacheWrite = (finalMsg.usage as any)?.cache_creation_input_tokens ?? 0;
    cacheRead = (finalMsg.usage as any)?.cache_read_input_tokens ?? 0;

    return {
      text: fullText,
      thinking: thinkingText || undefined,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        cachedTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: calcCost(model, inp, out, cacheWrite, cacheRead),
      },
    };
  }

  // ── Embeddings ────────────────────────────────────────────────────────────

  async embed(
    text: string,
    model = "voyage-3",
  ): Promise<number[]> {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Anthropic/Claude does not support native embeddings. " +
        "Please set the VOYAGE_API_KEY environment variable to use Voyage AI embeddings with Claude."
      );
    }
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: [text],
        model,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Voyage AI embedding failed (${response.status}): ${errText}`);
    }
    const data: any = await response.json();
    if (!data.data?.[0]?.embedding) {
      throw new Error("Failed to generate embedding from Voyage AI API");
    }
    return data.data[0].embedding;
  }

  // ── Batch API ─────────────────────────────────────────────────────────────

  /**
   * Submit a batch of requests to /v1/messages/batches.
   * Up to 10,000 requests per batch, 50% cost savings vs individual calls.
   * Processing window: up to 24 hours.
   */
  async submitBatch(requests: BatchRequest[]): Promise<BatchSubmitResult> {
    const batchRequests = requests.map((req) => {
      const systemMessages = req.messages.filter((m) => m.role === "system");
      const chatMessages = req.messages.filter((m) => m.role !== "system");
      const systemText =
        req.options?.systemPrompt ??
        systemMessages.map((m) => m.content).join("\n");

      const model = req.options?.model ?? "claude-sonnet-4-6";
      const maxTokens = req.options?.maxTokens ?? 2048;
      const thinking = req.options?.thinking;
      const thinkingParam = thinking
        ? buildThinkingParam(thinking, maxTokens)
        : null;

      const params: any = {
        model,
        max_tokens: maxTokens,
        temperature:
          thinkingParam?.temperature ?? req.options?.temperature ?? 0.7,
        messages: buildCachedMessages(chatMessages),
      };

      if (systemText) {
        params.system = buildSystemBlocks(systemText);
      }
      if (thinkingParam) {
        params.thinking = thinkingParam.thinking;
        params.betas = ["interleaved-thinking-2025-05-14"];
      }

      return {
        custom_id: req.customId,
        params,
      };
    });

    const batch = await (this.client.messages.batches as any).create({
      requests: batchRequests,
    });

    return {
      batchId: batch.id,
      status: mapBatchStatus(batch.processing_status),
      createdAt: batch.created_at ?? new Date().toISOString(),
      requestCount: requests.length,
      meta: {
        expiresAt: batch.expires_at,
        resultsUrl: batch.results_url,
      },
    };
  }

  /**
   * Poll a batch by ID. When completed, streams and parses NDJSON results.
   */
  async pollBatch(batchId: string): Promise<BatchPollResult> {
    const batch = await (this.client.messages.batches as any).retrieve(batchId);
    const status = mapBatchStatus(batch.processing_status);

    if (status !== "completed") {
      const counts = batch.request_counts ?? {};
      const total =
        (counts.processing ?? 0) +
        (counts.succeeded ?? 0) +
        (counts.errored ?? 0) +
        (counts.canceled ?? 0) +
        (counts.expired ?? 0);
      const done = (counts.succeeded ?? 0) + (counts.errored ?? 0);
      const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

      return {
        batchId,
        status,
        checkedAt: new Date().toISOString(),
        progressPct,
      };
    }

    // Stream NDJSON results
    const responses: BatchResponse[] = [];

    try {
      const resultStream = await (this.client.messages.batches as any).results(
        batchId,
      );

      for await (const result of resultStream) {
        const customId: string = result.custom_id;
        if (result.result?.type === "succeeded") {
          const { text, thinking } = extractContent(
            result.result.message.content ?? [],
          );
          const usage = result.result.message.usage;
          const inp = usage?.input_tokens ?? 0;
          const out = usage?.output_tokens ?? 0;
          const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
          const cacheRead = usage?.cache_read_input_tokens ?? 0;
          const model = result.result.message.model ?? "claude-sonnet-4-6";

          responses.push({
            customId,
            result: {
              text,
              thinking: thinking || undefined,
              usage: {
                inputTokens: inp,
                outputTokens: out,
                cachedTokens: cacheRead,
                cacheWriteTokens: cacheWrite,
                costUsd: calcCost(model, inp, out, cacheWrite, cacheRead),
              },
            },
          });
        } else {
          responses.push({
            customId,
            result: null,
            error:
              result.result?.error?.message ??
              result.result?.type ??
              "Unknown error",
          });
        }
      }
    } catch (err: any) {
      // If results URL not yet available or parse error
      return {
        batchId,
        status: "failed",
        checkedAt: new Date().toISOString(),
        responses: [],
      };
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
    await (this.client.messages.batches as any).cancel(batchId);
  }

  /**
   * Submit a batch and poll until completed.
   * @param intervalMs - polling interval in ms (default 10 000)
   * @param timeoutMs  - max wait in ms (default 24 h)
   */
  async runBatch(
    requests: BatchRequest[],
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<BatchResponse[]> {
    const { intervalMs = 10_000, timeoutMs = 24 * 60 * 60 * 1_000 } = opts;

    const { batchId } = await this.submitBatch(requests);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const poll = await this.pollBatch(batchId);

      if (poll.status === "completed") {
        return poll.responses ?? [];
      }
      if (poll.status === "failed") {
        throw new Error(`Batch ${batchId} failed.`);
      }
      if (poll.status === "cancelled" || poll.status === "expired") {
        throw new Error(`Batch ${batchId} was ${poll.status}.`);
      }
    }

    throw new Error(`Batch ${batchId} timed out after ${timeoutMs}ms.`);
  }
}
