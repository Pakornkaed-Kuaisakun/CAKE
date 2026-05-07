import type { AIProvider, ChatResult } from "../../providers/types.js";
import { searchAndAnswer } from "../../modules/search/index.js";
import { text } from "../utils/text.js";

export async function handleSearch(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const query = input.replace(/^(search|find|look up|google)\s+(for\s+)?/i, "").trim();
  const result = await searchAndAnswer(provider, query, model);
  return text(`[SEARCH] ${result}`);
}
