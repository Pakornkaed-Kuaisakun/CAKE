import { Ollama } from "ollama";
import type {
  AIProvider,
  Message,
  ChatOptions,
  ChatResult,
  StreamChunkCallback,
} from "./types.js";

export class OllamaProvider implements AIProvider {
  name = "ollama" as const;
  private client: Ollama;

  constructor(baseUrl?: string) {
    this.client = new Ollama({
      host: baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    });
  }

  async chat(
    messages: Message[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const { model = "llama3", temperature } = options;

    const response = await this.client.chat({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      options: temperature !== undefined ? { temperature } : undefined,
      // @ts-ignore
      signal: options.signal,
    });

    return {
      text: response.message.content,
      usage: {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
        costUsd: null,
      },
    };
  }

  async stream(
    messages: Message[],
    options: ChatOptions,
    onChunk: StreamChunkCallback,
  ): Promise<ChatResult> {
    const { model = "llama3", temperature } = options;

    const streamResponse = await this.client.chat({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      options: temperature !== undefined ? { temperature } : undefined,
      stream: true,
    });

    let fullText = "";
    let inp = 0;
    let out = 0;

    for await (const chunk of streamResponse) {
      const delta = chunk.message?.content;
      if (delta) {
        fullText += delta;
        onChunk(delta);
      }
      // Final chunk carries usage stats
      if (chunk.done) {
        inp = chunk.prompt_eval_count ?? 0;
        out = chunk.eval_count ?? 0;
      }
    }

    return {
      text: fullText,
      usage: { inputTokens: inp, outputTokens: out, costUsd: null },
    };
  }

  async embed(text: string, model = "nomic-embed-text"): Promise<number[]> {
    try {
      const response = await this.client.embeddings({ model, prompt: text });
      return response.embedding;
    } catch (err: any) {
      if (err.message?.includes("not found")) {
        throw new Error(
          `Embedding model "${model}" not found. Run: ollama pull ${model}`,
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
