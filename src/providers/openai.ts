// src/providers/openai.ts
//
// Prompt caching: AUTOMATIC on gpt-4o and newer (>= 1024 tokens).
// No code changes required to enable it — OpenAI handles it server-side.
//
// What we do here:
//   • Read cached_tokens from prompt_tokens_details
//   • Calculate cost correctly: cached input tokens cost 50% of standard
//   • Expose cachedTokens in TokenUsage so the UI can show savings
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

// Per-model pricing (input / cachedInput / output) per million tokens
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
};

function getPricing(model: string) {
  // Exact match first, then prefix match
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return val;
  }
  return { input: 2.5, cachedInput: 1.25, output: 10.0 }; // gpt-4o fallback
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

export class OpenAIProvider implements AIProvider {
  name = "openai" as const;
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async chat(
    messages: Message[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const {
      model = "gpt-4o",
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
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

    const response = await this.client.chat.completions.create(
      { model, messages: allMessages, max_tokens: maxTokens, temperature },
      { signal: options.signal },
    );

    const text = response.choices[0]?.message?.content ?? "";
    const inp = response.usage?.prompt_tokens ?? 0;
    const out = response.usage?.completion_tokens ?? 0;
    const cached =
      (response.usage?.prompt_tokens_details as any)?.cached_tokens ?? 0;

    return {
      text,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        cachedTokens: cached,
        costUsd: calcCost(model, inp, out, cached),
      },
    };
  }

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
    let inp = 0;
    let out = 0;
    let cached = 0;

    for await (const chunk of streamResponse) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        onChunk(delta);
      }
      if (chunk.usage) {
        inp = chunk.usage.prompt_tokens ?? 0;
        out = chunk.usage.completion_tokens ?? 0;
        cached = (chunk.usage.prompt_tokens_details as any)?.cached_tokens ?? 0;
      }
    }

    return {
      text: fullText,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        cachedTokens: cached,
        costUsd: calcCost(model, inp, out, cached),
      },
    };
  }

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
}
