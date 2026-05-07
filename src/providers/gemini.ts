import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, Message, ChatOptions, ChatResult } from "./types.js";

// Pricing per million tokens — gemini-1.5-pro (as of 2025)
const PRICE_INPUT = 3.5 / 1_000_000;
const PRICE_OUTPUT = 10.5 / 1_000_000;

export class GeminiProvider implements AIProvider {
  name = "gemini" as const;
  private client: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenerativeAI(
      apiKey ?? process.env.GEMINI_API_KEY ?? "",
    );
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResult> {
    const { model = "gemini-1.5-pro", systemPrompt } = options;

    const genModel = this.client.getGenerativeModel({
      model,
      systemInstruction:
        systemPrompt ?? "You are CAKE, a helpful AI assistant.",
    });

    const history = messages
      .filter((m) => m.role !== "system")
      .slice(0, -1)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const lastMessage = messages.filter((m) => m.role !== "system").at(-1);
    if (!lastMessage) return { text: "" };

    const chat = genModel.startChat({ history });
    const result = await chat.sendMessage(lastMessage.content);
    const text = result.response.text();

    const meta = result.response.usageMetadata;
    const inp = meta?.promptTokenCount ?? 0;
    const out = meta?.candidatesTokenCount ?? 0;

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
