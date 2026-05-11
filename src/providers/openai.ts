import OpenAI from "openai";
import type { AIProvider, Message, ChatOptions, ChatResult } from "./types.js";

// Pricing per million tokens — gpt-4o (as of 2025)
const PRICE_INPUT = 5.0 / 1_000_000;
const PRICE_OUTPUT = 15.0 / 1_000_000;

export class OpenAIProvider implements AIProvider {
  name = "openai" as const;
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResult> {
    const {
      model = "gpt-4o",
      systemPrompt,
      maxTokens = 2048,
      temperature = 0.7,
    } = options;

    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      allMessages.push({ role: "system", content: systemPrompt });
    }

    for (const m of messages) {
      if (m.role === "system" && !systemPrompt) {
        allMessages.push({ role: "system", content: m.content });
      } else if (m.role !== "system") {
        allMessages.push({ role: m.role, content: m.content });
      }
    }

    const response = await this.client.chat.completions.create(
      {
        model,
        messages: allMessages,
        max_tokens: maxTokens,
        temperature,
      },
      { signal: options.signal },
    );

    const text = response.choices[0]?.message?.content ?? "";
    const inp = response.usage?.prompt_tokens ?? 0;
    const out = response.usage?.completion_tokens ?? 0;

    return {
      text,
      usage: {
        inputTokens: inp,
        outputTokens: out,
        costUsd: inp * PRICE_INPUT + out * PRICE_OUTPUT,
      },
    };
  }

  async embed(text: string, model = "text-embedding-3-small"): Promise<number[]> {
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
