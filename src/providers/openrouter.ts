// src/providers/openrouter.ts
//
// OpenRouter provider — OpenAI-compatible API with 429 retry + fallback.
// Free models: https://openrouter.ai/models?q=:free
//
// .env keys:
//   OPENROUTER_API_KEY=sk-or-...
//   OPENROUTER_MODEL=google/gemma-3-27b-it:free        (main model)
//   OPENROUTER_FAST_MODEL=google/gemma-3-12b-it:free   (intent routing)

import OpenAI from "openai";
import type {
  AIProvider,
  Message,
  ChatOptions,
  ChatResult,
  StreamChunkCallback,
} from "./types.js";

// ── Free-tier fallback chain ─────────────────────────────────────────────────
// Tried in order when a model returns 429. Edit to taste.
const FREE_FALLBACKS = [
  "openai/gpt-oss-20b:free",
  "deepseek/deepseek-v4-flash:free",
  "baidu/qianfan-ocr-fast:free",
  "google/gemma-4-26b-a4b-it:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
];

const DEFAULT_MAIN =
  process.env.OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function is429(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) return err.status === 429;
  if (err instanceof Error) return err.message.includes("429");
  return false;
}

export class OpenRouterProvider implements AIProvider {
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

  // ── Build OpenAI message array ────────────────────────────────────────────
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

  // ── Build fallback chain (requested model first, then free chain) ─────────
  private buildChain(model: string): string[] {
    return [model, ...FREE_FALLBACKS.filter((m) => m !== model)];
  }

  // ── Chat with retry + model fallback on 429 ───────────────────────────────
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
    } = options;

    const msgs = this.buildMessages(messages, systemPrompt);
    const chain = this.buildChain(model);
    let lastErr: unknown;

    for (let i = 0; i < chain.length; i++) {
      const m = chain[i];
      try {
        const response = await this.client.chat.completions.create(
          { model: m, messages: msgs, max_tokens: maxTokens, temperature },
          { signal },
        );
        const text = response.choices[0]?.message?.content ?? "";
        const inp = response.usage?.prompt_tokens ?? 0;
        const out = response.usage?.completion_tokens ?? 0;
        if (i > 0)
          console.warn(
            `[openrouter] fell back to "${m}" after 429 on "${chain[0]}"`,
          );
        return {
          text,
          usage: { inputTokens: inp, outputTokens: out, costUsd: 0 },
        };
      } catch (err) {
        lastErr = err;
        if (!is429(err)) throw err; // non-429: bail immediately
        const wait = 1500 * (i + 1); // 1.5 s, 3 s, 4.5 s …
        console.warn(
          `[openrouter] 429 on "${m}" — trying next model in ${wait}ms`,
        );
        await sleep(wait);
      }
    }

    throw new Error(
      `[openrouter] All models rate-limited (429).\n` +
        `Tip: wait a few seconds and retry, or add a paid OPENROUTER_API_KEY.\n` +
        `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  // ── Streaming with retry + model fallback on 429 ─────────────────────────
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
    } = options;

    const msgs = this.buildMessages(messages, systemPrompt);
    const chain = this.buildChain(model);
    let lastErr: unknown;

    for (let i = 0; i < chain.length; i++) {
      const m = chain[i];
      try {
        const streamResponse = await this.client.chat.completions.create(
          {
            model: m,
            messages: msgs,
            max_tokens: maxTokens,
            temperature,
            stream: true,
          },
          { signal },
        );

        let fullText = "";
        let inp = 0;
        let out = 0;

        for await (const chunk of streamResponse) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
          if (chunk.usage) {
            inp = chunk.usage.prompt_tokens ?? 0;
            out = chunk.usage.completion_tokens ?? 0;
          }
        }

        if (i > 0) console.warn(`[openrouter] streamed with fallback "${m}"`);
        return {
          text: fullText,
          usage: { inputTokens: inp, outputTokens: out, costUsd: 0 },
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
}
