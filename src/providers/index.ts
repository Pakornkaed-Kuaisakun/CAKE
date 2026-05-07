// src/providers/index.ts
import type { AIProvider, ProviderName } from "./types.js";
import { ClaudeProvider } from "./claude.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";

export { ClaudeProvider, OpenAIProvider, GeminiProvider, OllamaProvider };
export type {
  AIProvider,
  ProviderName,
  Message,
  ChatOptions,
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
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

export function getDefaultProvider(): AIProvider {
  const name = (process.env.DEFAULT_PROVIDER ?? "claude") as ProviderName;
  return createProvider(name);
}
