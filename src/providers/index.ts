// src/providers/index.ts
import type { AIProvider, ProviderName } from "./types.js";
import { ClaudeProvider } from "./claude.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";
import { OpenRouterProvider } from "./openrouter.js";
import { PuterProvider } from "./puter.js";

export {
  ClaudeProvider,
  OpenAIProvider,
  GeminiProvider,
  OllamaProvider,
  OpenRouterProvider,
  PuterProvider,
};

export type {
  AIProvider,
  ProviderName,
  Message,
  ChatOptions,
  ChatResult,
  TokenUsage,
  StreamChunkCallback,
  // Batch types
  BatchRequest,
  BatchResponse,
  BatchSubmitResult,
  BatchPollResult,
  BatchProvider,
  BatchStatus,
  // Thinking types
  ThinkingConfig,
  ThinkingLevel,
} from "./types.js";

export function createProvider(name: ProviderName): AIProvider {
  switch (name) {
    case "claude":
      return new ClaudeProvider();
    case "openai":
      return new OpenAIProvider();
    case "gemini":
      return new GeminiProvider();
    case "ollama":
      return new OllamaProvider();
    case "openrouter":
      return new OpenRouterProvider();
    case "puter":
      return new PuterProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

export function getDefaultProvider(): AIProvider {
  const name = (process.env.DEFAULT_PROVIDER ?? "claude") as ProviderName;
  return createProvider(name);
}
