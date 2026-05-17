// src/providers/gemini.ts
//
// Prompt caching: AUTOMATIC (implicit) on Gemini 2.5+ models.
// No code changes required — Google handles it server-side.
//
// What we do here:
//   • Default model bumped to gemini-2.5-flash (supports implicit caching)
//   • Read cached_content_token_count from usage_metadata
//   • Calculate cost correctly: cached tokens cost 25% of standard on 2.5 models
//   • Expose cachedTokens in TokenUsage so the UI can show savings
//
// Pricing (gemini-2.5-flash):
//   Standard input  : $0.15 / M tokens  (under 200k ctx)
//   Cached input    : $0.0375 / M tokens (75% saving)
//   Output          : $0.60 / M tokens
//
// Pricing (gemini-2.5-pro):
//   Standard input  : $1.25 / M tokens  (under 200k ctx)
//   Cached input    : $0.31 / M tokens  (75% saving)
//   Output          : $10.00 / M tokens

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, Message, ChatOptions, ChatResult } from "./types.js";

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
  return { input: 0.15, cachedInput: 0.0375, output: 0.6 }; // 2.5-flash fallback
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

export class GeminiProvider implements AIProvider {
  name = "gemini" as const;
  private client: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenerativeAI(
      apiKey ?? process.env.GEMINI_API_KEY ?? "",
    );
  }

  async chat(
    messages: Message[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    // Default to gemini-2.5-flash: supports implicit caching, fast, cheap
    const { model = "gemini-2.5-flash", systemPrompt } = options;

    const genModel = this.client.getGenerativeModel({
      model,
      systemInstruction:
        systemPrompt ?? "You are CAKE, a helpful AI assistant.",
    });

    // Separate history from the last user message
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

    const text = result.response.text();
    const meta = result.response.usageMetadata;

    const inp = meta?.promptTokenCount ?? 0;
    const out = meta?.candidatesTokenCount ?? 0;
    // Gemini returns cached token count here (implicit or explicit)
    const cached = (meta as any)?.cachedContentTokenCount ?? 0;

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
}
