// src/providers/claude.ts
//
// Prompt caching: uses explicit cache_control breakpoints.
//
// Strategy — cache up to 4 breakpoints (API limit) in this order:
//   1. System prompt          → always cached (largest static block)
//   2. Last assistant turn    → cache the growing conversation prefix
//   3. Second-to-last user+assistant pair (if history is long)
//
// Pricing (Sonnet 4.6):
//   Standard input  : $3.00 / M tokens
//   Cache write     : $3.75 / M tokens  (1.25×)
//   Cache read      : $0.30 / M tokens  (0.10×)  ← 90% saving
//   Output          : $15.00 / M tokens

import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  Message,
  ChatOptions,
  ChatResult,
  StreamChunkCallback,
} from "./types.js";

// Per-model pricing (input / cache_write / cache_read / output) per million tokens
const MODEL_PRICING: Record<
  string,
  { input: number; cacheWrite: number; cacheRead: number; output: number }
> = {
  // Claude Sonnet 4.6 (default)
  "claude-sonnet-4-6": {
    input: 3.0,
    cacheWrite: 3.75,
    cacheRead: 0.3,
    output: 15.0,
  },
  // Claude Opus 4.6
  "claude-opus-4-6": {
    input: 15.0,
    cacheWrite: 18.75,
    cacheRead: 1.5,
    output: 75.0,
  },
  // Claude Haiku 4.5
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    cacheWrite: 1.0,
    cacheRead: 0.08,
    output: 4.0,
  },
  // Fallback / older names
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

// Minimum tokens needed before the API will honour cache_control.
// Haiku requires 2048; all others require 1024.
function minCacheTokens(model: string): number {
  return model.includes("haiku") ? 2048 : 1024;
}

// ── Build message array with cache_control breakpoints ────────────────────────
//
// Claude caches everything UP TO AND INCLUDING the marked block.
// We mark:
//   • The system prompt (always — it never changes between turns)
//   • The last assistant message in history (catches multi-turn prefix)
//
// The API allows max 4 breakpoints; we use at most 2.

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

  // Find the last assistant message index — mark it as a cache breakpoint.
  // This caches everything up to that turn (the stable conversation prefix).
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

// ── System prompt block with cache_control ────────────────────────────────────

type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

function buildSystemBlocks(systemText: string): SystemBlock[] {
  if (!systemText.trim()) return [];
  return [
    {
      type: "text",
      text: systemText,
      cache_control: { type: "ephemeral" },
    },
  ];
}

// ── Cost calculation ──────────────────────────────────────────────────────────

function calcCost(
  model: string,
  inp: number,
  out: number,
  cacheWrite: number,
  cacheRead: number,
): number {
  const p = getPricing(model);
  const M = 1_000_000;
  // Standard input = inp minus cache reads/writes (those are billed separately)
  const standardInput = Math.max(0, inp - cacheWrite - cacheRead);
  return (
    (standardInput * p.input) / M +
    (cacheWrite * p.cacheWrite) / M +
    (cacheRead * p.cacheRead) / M +
    (out * p.output) / M
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class ClaudeProvider implements AIProvider {
  name = "claude" as const;
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  async chat(
    messages: Message[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const {
      model = "claude-sonnet-4-6",
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
    } = options;

    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const systemText =
      systemPrompt ?? systemMessages.map((m) => m.content).join("\n");

    const system = buildSystemBlocks(systemText);
    const builtMessages = buildCachedMessages(chatMessages);

    const response = await this.client.messages.create(
      {
        model,
        system: system.length > 0 ? system : undefined,
        max_tokens: maxTokens,
        temperature,
        messages: builtMessages,
      } as any,
      { signal: options.signal },
    );

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const inp = response.usage?.input_tokens ?? 0;
    const out = response.usage?.output_tokens ?? 0;
    const cacheWrite =
      (response.usage as any)?.cache_creation_input_tokens ?? 0;
    const cacheRead = (response.usage as any)?.cache_read_input_tokens ?? 0;

    return {
      text,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        cachedTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: calcCost(model, inp, out, cacheWrite, cacheRead),
      },
    };
  }

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
    } = options;

    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const systemText =
      systemPrompt ?? systemMessages.map((m) => m.content).join("\n");

    const system = buildSystemBlocks(systemText);
    const builtMessages = buildCachedMessages(chatMessages);

    let fullText = "";
    let inp = 0;
    let out = 0;
    let cacheWrite = 0;
    let cacheRead = 0;

    const streamResponse = await this.client.messages.stream(
      {
        model,
        system: system.length > 0 ? system : undefined,
        max_tokens: maxTokens,
        temperature,
        messages: builtMessages,
      } as any,
      { signal: options.signal },
    );

    for await (const event of streamResponse) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        const chunk = event.delta.text;
        fullText += chunk;
        onChunk(chunk);
      }
    }

    const finalMsg = await streamResponse.finalMessage();
    inp = finalMsg.usage?.input_tokens ?? 0;
    out = finalMsg.usage?.output_tokens ?? 0;
    cacheWrite = (finalMsg.usage as any)?.cache_creation_input_tokens ?? 0;
    cacheRead = (finalMsg.usage as any)?.cache_read_input_tokens ?? 0;

    return {
      text: fullText,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        cachedTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: calcCost(model, inp, out, cacheWrite, cacheRead),
      },
    };
  }
}
