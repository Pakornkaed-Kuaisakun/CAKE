// src/providers/types.ts

export type ProviderName =
  | "claude"
  | "openai"
  | "gemini"
  | "ollama"
  | "openrouter"
  | "puter";

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
  /** Enable extended thinking / chain-of-thought reasoning */
  thinking?: import("./batch-types.js").ThinkingConfig;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the provider's prompt cache (subset of inputTokens) */
  cachedTokens?: number;
  /** Tokens written INTO the cache this request (Claude-specific) */
  cacheWriteTokens?: number;
  /** Thinking/reasoning tokens used (Claude extended thinking, OpenAI reasoning) */
  thinkingTokens?: number;
  costUsd: number | null;
}

export interface ChatResult {
  text: string;
  /** Extracted chain-of-thought reasoning (if thinking was enabled) */
  thinking?: string;
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

// Re-export batch types for convenience
export type {
  BatchRequest,
  BatchResponse,
  BatchSubmitResult,
  BatchPollResult,
  BatchProvider,
  BatchStatus,
  ThinkingConfig,
  ThinkingLevel,
} from "./batch-types.js";
