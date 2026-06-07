import type { AIProvider, ChatResult } from "../../providers/types.js";
import { searchAndAnswer } from "../../modules/search/index.js";
import { stripVerb, formatChatResult } from "../../shared/utils/utils.js";

export async function handleSearch(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const query = stripVerb(input, [
    "search for",
    "find for",
    "look up for",
    "google for",
    "search",
    "find",
    "look up",
    "google",
  ]);
  const result = await searchAndAnswer(provider, query, model);
  return formatChatResult(`[SEARCH] ${result}`);
}
