import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, Message, ChatOptions, ChatResult } from "./types.js";

// Pricing per million tokens (as of 2025)
const PRICE_INPUT = 3.0 / 1_000_000; // claude-opus-4-5
const PRICE_OUTPUT = 15.0 / 1_000_000;

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
      model = "claude-sonnet-4-5",
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
    } = options;

    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const system =
      systemPrompt ??
      systemMessages.map((m) => m.content).join("\n") ??
      "You are CAKE, a helpful AI assistant.";

    const response = await this.client.messages.create(
      {
        model,
        system,
        max_tokens: maxTokens,
        temperature,
        messages: chatMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      },
      { signal: options.signal },
    );

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const inp = response.usage?.input_tokens ?? 0;
    const out = response.usage?.output_tokens ?? 0;

    return {
      text,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        costUsd: inp * PRICE_INPUT + out * PRICE_OUTPUT,
      },
    };
  }
}
