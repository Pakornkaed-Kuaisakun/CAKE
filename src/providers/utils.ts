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
      return "claude-3-haiku-20240307";
    case "gemini":
      return "gemini-1.5-flash";
    case "ollama":
      return "qwen2.5:3b";
    default:
      return undefined;
  }
}
