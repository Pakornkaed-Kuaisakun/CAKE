import type { AIProvider } from "../../providers/types.js";

const TOPIC_ALIASES: Record<string, string[]> = {
  economy: ["economy", "economic", "finance", "market", "stocks", "inflation"],

  tech: ["tech", "technology", "software", "startup", "ai"],

  gold: ["gold", "xauusd", "commodities"],

  war: ["war", "military", "ukraine", "conflict"],

  world: ["world", "global", "international"],

  crypto: ["crypto", "bitcoin", "ethereum"],

  ai: ["ai", "llm", "openai", "claude"],
};

export async function extractTopic(
  input: string,
  provider: AIProvider,
  model?: string,
): Promise<string | null> {
  if (provider) {
    try {
      const prompt = `
        You are a topic classification system.
        Classify the following user input into one of these categories:
        ${Object.keys(TOPIC_ALIASES).join(", ")}

        Input: ${input}

        Respond with ONLY the topic name (lowercase).`;

      const response = await provider.chat(
        [{ role: "user", content: prompt }],
        { model },
      );

      const classified = response.text.trim().toLowerCase();

      if (classified && TOPIC_ALIASES[classified]) {
        return classified;
      }
    } catch (error) {
      console.error(`[TOPIC_AI_ERROR] Failed to classify topic:`, error);
    }
  }

  const lower = input.toLowerCase();

  for (const [topic, aliases] of Object.entries(TOPIC_ALIASES)) {
    for (const alias of aliases) {
      if (lower.includes(alias)) {
        return topic;
      }
    }
  }

  return null;
}
