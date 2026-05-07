import type { AIProvider } from "../../providers/types.js";
import { search, type SearchResult } from "./searchEngine.js";

export async function searchAndAnswer(
  provider: AIProvider,
  query: string,
  model?: string,
): Promise<string> {
  const results = await search(query);

  if (results.length === 0) {
    const r = await provider.chat([{ role: "user", content: query }], { model });
    return r.text;
  }

  const context = results
    .map((r, i) => `[${i + 1}] (${r.source}) ${r.title}\n${r.snippet}\nURL: ${r.url}`)
    .join("\n\n");

  const prompt = `Based on these search results, answer: "${query}"\n\n${context}\n\nBe concise and cite sources [1], [2] etc where useful.`;
  const result = await provider.chat([{ role: "user", content: prompt }], { model });
  return result.text;
}
