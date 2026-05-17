// src/providers/gemini.ts
//
// Prompt caching: AUTOMATIC (implicit) on Gemini 2.5+ models.
//
// Thinking Budget:
//   Gemini 2.5 Flash/Pro support native thinking via thinkingConfig.
//   Options:
//     thinking_config.thinking_budget = <int>   (0 = off, -1 = dynamic, 1-24576 = fixed)
//     thinking_config.include_thoughts = true   (return thinking text)
//   OR shorthand: thinking_level = "LOW" | "MEDIUM" | "HIGH" | "NONE"
//
//   Mapping from ThinkingConfig:
//     level "low"    → thinking_budget 512
//     level "medium" → thinking_budget 4096  (or dynamic if not set)
//     level "high"   → thinking_budget 16384
//     budgetTokens   → used directly (0 disables thinking)
//
// Batch API:
//   Uses google.ai.generativelanguage JSONL batch via REST.
//   Endpoint: POST https://generativelanguage.googleapis.com/v1beta/batches
//   Poll:     GET  .../batches/{name}
//   Results are stored as a Google Cloud Storage output file.
//
//   NOTE: The official Node SDK (@google/generative-ai) does NOT expose a
//   batches() method as of this writing. We use the REST API directly via fetch.
//
// Pricing (gemini-2.5-flash):
//   Standard input  : $0.15 / M tokens  (under 200k ctx)
//   Cached input    : $0.0375 / M tokens (75% saving)
//   Output          : $0.60 / M tokens

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, Message, ChatOptions, ChatResult } from "./types.js";
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
  "gemini-2.5-flash": { input: 0.15, cachedInput: 0.0375, output: 0.6 },
  "gemini-2.5-pro": { input: 1.25, cachedInput: 0.3125, output: 10.0 },
  "gemini-2.0-flash": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gemini-1.5-pro": { input: 1.25, cachedInput: 0.3125, output: 5.0 },
  "gemini-1.5-flash": { input: 0.075, cachedInput: 0.01875, output: 0.3 },
};

function getPricing(model: string) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return val;
  }
  return { input: 0.15, cachedInput: 0.0375, output: 0.6 };
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

// ── Thinking helpers ──────────────────────────────────────────────────────────

/**
 * Build Gemini thinkingConfig from our ThinkingConfig.
 * Returns null if thinking is disabled or not configured.
 */
function buildThinkingConfig(thinking: NonNullable<ChatOptions["thinking"]>): {
  thinkingConfig: { thinkingBudget: number; includeThoughts: boolean };
} | null {
  if (!thinking.enabled) return null;

  // Map level → budget
  const levelMap: Record<string, number> = {
    low: 512,
    medium: 4096,
    high: 16384,
  };

  let budget: number;
  if (thinking.budgetTokens !== undefined) {
    budget = thinking.budgetTokens; // 0 = disabled, -1 = dynamic
  } else if (thinking.level) {
    budget = levelMap[thinking.level] ?? 4096;
  } else {
    budget = -1; // dynamic (model decides)
  }

  return {
    thinkingConfig: {
      thinkingBudget: budget,
      includeThoughts: true,
    },
  };
}

/**
 * Extract text and thinking parts from Gemini response candidates.
 * Thinking parts have `thought: true` in the Gemini API response.
 */
function extractGeminiContent(response: any): {
  text: string;
  thinking: string;
} {
  let text = "";
  let thinking = "";

  try {
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.thought === true) {
        thinking += part.text ?? "";
      } else {
        text += part.text ?? "";
      }
    }
  } catch {
    // Fall back to standard text extraction
    text = response.text?.() ?? "";
  }

  return { text: text || response.response?.text?.() || "", thinking };
}

// ── Batch helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

const GEMINI_BATCH_BASE = "https://generativelanguage.googleapis.com/v1beta";

function mapGeminiBatchStatus(
  state: string,
): import("./batch-types.js").BatchStatus {
  const map: Record<string, import("./batch-types.js").BatchStatus> = {
    JOB_STATE_PENDING: "pending",
    JOB_STATE_RUNNING: "processing",
    JOB_STATE_SUCCEEDED: "completed",
    JOB_STATE_FAILED: "failed",
    JOB_STATE_CANCELLING: "processing",
    JOB_STATE_CANCELLED: "cancelled",
    JOB_STATE_PAUSED: "pending",
    JOB_STATE_EXPIRED: "expired",
  };
  return map[state] ?? "pending";
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class GeminiProvider implements AIProvider, BatchProvider {
  name = "gemini" as const;
  private client: GoogleGenerativeAI;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.client = new GoogleGenerativeAI(this.apiKey);
  }

  // ── chat ──────────────────────────────────────────────────────────────────

  async chat(
    messages: Message[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const { model = "gemini-2.5-flash", systemPrompt, thinking } = options;

    const thinkingCfg = thinking ? buildThinkingConfig(thinking) : null;

    const genModelConfig: any = {
      model,
      systemInstruction:
        systemPrompt ?? "You are CAKE, a helpful AI assistant.",
    };

    if (thinkingCfg) {
      genModelConfig.generationConfig = thinkingCfg;
    }

    const genModel = this.client.getGenerativeModel(genModelConfig);

    const nonSystem = messages.filter((m) => m.role !== "system");
    const history = nonSystem.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const lastMessage = nonSystem.at(-1);
    if (!lastMessage) return { text: "" };

    const chat = genModel.startChat({ history });
    const result = await chat.sendMessage(lastMessage.content, {
      signal: options.signal,
    } as any);

    // Extract thinking if enabled
    let text: string;
    let thinkingText = "";

    if (thinkingCfg) {
      const extracted = extractGeminiContent(result.response);
      text = extracted.text;
      thinkingText = extracted.thinking;
    } else {
      text = result.response.text();
    }

    const meta = result.response.usageMetadata;
    const inp = meta?.promptTokenCount ?? 0;
    const out = meta?.candidatesTokenCount ?? 0;
    const cached = (meta as any)?.cachedContentTokenCount ?? 0;
    const thinkingTokens = (meta as any)?.thoughtsTokenCount ?? 0;

    return {
      text,
      thinking: thinkingText || undefined,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        cachedTokens: cached,
        thinkingTokens: thinkingTokens > 0 ? thinkingTokens : undefined,
        costUsd: calcCost(model, inp, out, cached),
      },
    };
  }

  // ── Batch API ─────────────────────────────────────────────────────────────

  /**
   * Submit a batch using Gemini's REST batch endpoint.
   * Builds a JSONL-style request body and POSTs to /v1beta/batches.
   *
   * Each request is an "inline request" with its content.
   */
  async submitBatch(requests: BatchRequest[]): Promise<BatchSubmitResult> {
    const model = requests[0]?.options?.model ?? "gemini-2.5-flash";
    const modelPath = `models/${model}`;

    // Build inline requests array
    const inlineRequests = requests.map((req) => {
      const nonSystem = req.messages.filter((m) => m.role !== "system");
      const systemMsg = req.messages.find((m) => m.role === "system");
      const sysText = req.options?.systemPrompt ?? systemMsg?.content ?? "";

      const contents = nonSystem.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const reqModel = req.options?.model ?? model;
      const thinking = req.options?.thinking;
      const thinkingCfg = thinking ? buildThinkingConfig(thinking) : null;

      const generateContentRequest: any = {
        model: `models/${reqModel}`,
        contents,
      };

      if (sysText) {
        generateContentRequest.systemInstruction = {
          parts: [{ text: sysText }],
        };
      }
      if (thinkingCfg) {
        generateContentRequest.generationConfig = thinkingCfg;
      }

      return {
        // customId stored as metadata key for correlation
        request: generateContentRequest,
        _customId: req.customId, // stored separately; included in output parsing
      };
    });

    // POST to Gemini Batch API
    const response = await fetch(`${GEMINI_BATCH_BASE}/batches`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        model: modelPath,
        requests: inlineRequests.map((r, i) => ({
          ...r.request,
          // Embed customId in a user-defined metadata field
          labels: { custom_id: r._customId, index: String(i) },
        })),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `Gemini batch submit failed (${response.status}): ${err}`,
      );
    }

    const data: any = await response.json();

    return {
      batchId: data.name, // e.g. "batches/batch_abc123"
      status: mapGeminiBatchStatus(data.state ?? "JOB_STATE_PENDING"),
      createdAt: data.createTime ?? new Date().toISOString(),
      requestCount: requests.length,
      meta: {
        displayName: data.displayName,
        expireTime: data.expireTime,
        // Store customIds for response correlation
        customIds: inlineRequests.map((r) => r._customId),
      },
    };
  }

  /**
   * Poll a Gemini batch job by its resource name.
   */
  async pollBatch(batchId: string): Promise<BatchPollResult> {
    const response = await fetch(`${GEMINI_BATCH_BASE}/${batchId}`, {
      headers: { "x-goog-api-key": this.apiKey },
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini batch poll failed (${response.status}): ${err}`);
    }

    const data: any = await response.json();
    const status = mapGeminiBatchStatus(data.state ?? "JOB_STATE_PENDING");

    if (status !== "completed") {
      return {
        batchId,
        status,
        checkedAt: new Date().toISOString(),
      };
    }

    // Fetch results
    const responses: BatchResponse[] = [];
    const customIds: string[] = data.metadata?.customIds ?? [];

    try {
      const resultsResp = await fetch(
        `${GEMINI_BATCH_BASE}/${batchId}/results`,
        { headers: { "x-goog-api-key": this.apiKey } },
      );

      if (resultsResp.ok) {
        const resultsData: any = await resultsResp.json();
        const results = resultsData.responses ?? [];

        results.forEach((r: any, idx: number) => {
          const customId = customIds[idx] ?? String(idx);
          const candidate = r.response?.candidates?.[0];

          if (candidate) {
            const parts = candidate.content?.parts ?? [];
            let text = "";
            let thinking = "";
            for (const part of parts) {
              if (part.thought) thinking += part.text ?? "";
              else text += part.text ?? "";
            }

            const meta = r.response?.usageMetadata;
            const inp = meta?.promptTokenCount ?? 0;
            const out = meta?.candidatesTokenCount ?? 0;
            const cached = meta?.cachedContentTokenCount ?? 0;
            const reqModel =
              data.model?.replace("models/", "") ?? "gemini-2.5-flash";

            responses.push({
              customId,
              result: {
                text: text || parts.map((p: any) => p.text).join(""),
                thinking: thinking || undefined,
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
                r.response?.promptFeedback?.blockReason ??
                r.error?.message ??
                "No candidate returned",
            });
          }
        });
      }
    } catch (err: any) {
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
   * Cancel a Gemini batch job.
   */
  async cancelBatch(batchId: string): Promise<void> {
    await fetch(`${GEMINI_BATCH_BASE}/${batchId}:cancel`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey },
    });
  }

  /**
   * Submit and wait for completion.
   */
  async runBatch(
    requests: BatchRequest[],
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<BatchResponse[]> {
    const { intervalMs = 30_000, timeoutMs = 24 * 60 * 60 * 1_000 } = opts;

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
