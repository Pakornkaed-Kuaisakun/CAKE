export type ProviderName =
  | "claude"
  | "openai"
  | "gemini"
  | "ollama"
  | "openrouter";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface ChatResult {
  text: string;
  usage?: TokenUsage;
}

/** Callback invoked with each new text chunk as it arrives from the model. */
export type StreamChunkCallback = (chunk: string) => void;

export interface AIProvider {
  name: ProviderName;
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResult>;
  /** Stream response chunks. Falls back to chat() if not implemented. */
  stream?(
    messages: Message[],
    options: ChatOptions,
    onChunk: StreamChunkCallback,
  ): Promise<ChatResult>;
  embed?(text: string, model?: string): Promise<number[]>;
  listModels?(): Promise<string[]>;
}
