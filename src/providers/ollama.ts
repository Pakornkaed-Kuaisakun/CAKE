import { Ollama } from "ollama";
import type { AIProvider, Message, ChatOptions, ChatResult } from "./types.js";

export class OllamaProvider implements AIProvider {
  name = "ollama" as const;
  private client: Ollama;

  constructor(baseUrl?: string) {
    this.client = new Ollama({
      host: baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    });
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResult> {
    const { model = "llama3", temperature } = options;

    const response = await this.client.chat({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      options: temperature !== undefined ? { temperature } : undefined,
    });

    return {
      text: response.message.content,
      usage: {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
        costUsd: null, // local model — no cost
      },
    };
  }

  async embed(text: string, model = "nomic-embed-text"): Promise<number[]> {
    try {
      const response = await this.client.embeddings({
        model,
        prompt: text,
      });
      return response.embedding;
    } catch (err: any) {
      if (err.message?.includes("not found")) {
        throw new Error(
          `Embedding model "${model}" not found. Please run: ollama pull ${model}`
        );
      }
      throw err;
    }
  }


  async listModels(): Promise<string[]> {

    const list = await this.client.list();
    return list.models.map((m) => m.name);
  }
}
