import type { ProviderName } from "./types.js";

/**
 * Returns the fastest/cheapest model name for a given provider.
 * Ideal for intent routing and small data extraction.
 */
export function getFastModel(provider: ProviderName): string | undefined {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "claude":
      return "claude-haiku-4-5-20251001";
    case "gemini":
      return "gemini-2.0-flash";
    case "ollama":
      return "qwen2.5:3b";
    case "openrouter":
      return "nvidia/nemotron-3-nano-30b-a3b:free";
    default:
      return undefined;
  }
}
