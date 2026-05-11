export type ProviderName = "claude" | "openai" | "gemini" | "ollama";

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
  /** Estimated cost in USD. null for local models. */
  costUsd: number | null;
}

export interface ChatResult {
  text: string;
  usage?: TokenUsage;
}

export interface AIProvider {
  name: ProviderName;
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResult>;
  embed?(text: string, model?: string): Promise<number[]>;
  listModels?(): Promise<string[]>;
}

