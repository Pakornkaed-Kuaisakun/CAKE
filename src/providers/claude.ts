import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  Message,
  ChatOptions,
  ChatResult,
  StreamChunkCallback,
} from "./types.js";

const PRICE_INPUT = 3.0 / 1_000_000;
const PRICE_OUTPUT = 15.0 / 1_000_000;

export class ClaudeProvider implements AIProvider {
  name = "claude" as const;
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  // ── Non-streaming (used by tool handlers, intent router, etc.) ──────────────
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

  // ── Streaming ───────────────────────────────────────────────────────────────
  async stream(
    messages: Message[],
    options: ChatOptions,
    onChunk: StreamChunkCallback,
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

    let fullText = "";
    let inp = 0;
    let out = 0;

    const streamResponse = await this.client.messages.stream(
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

    return {
      text: fullText,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        costUsd: inp * PRICE_INPUT + out * PRICE_OUTPUT,
      },
    };
  }
}
