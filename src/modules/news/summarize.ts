import type { AIProvider } from "../../providers/types.js";
import type { RawArticle } from "./fetchHelper/types.js";

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  summary: string;
}

export async function summarizeArticle(
  provider: AIProvider,
  article: RawArticle,
  model?: string,
): Promise<NewsItem> {
  const prompt = `Summarize this news article in 1-2 sentences:\n\nTitle: ${article.title}\n\n${article.content.slice(0, 1500)}`;
  const result = await provider.chat([{ role: "user", content: prompt }], { model });
  return {
    title: article.title,
    source: article.source,
    link: article.link,
    summary: result.text,
  };
}

export async function summarizeAll(
  provider: AIProvider,
  items: RawArticle[],
  model?: string,
): Promise<NewsItem[]> {
  return Promise.all(items.map((e) => summarizeArticle(provider, e, model)));
}

export async function buildDigest(
  provider: AIProvider,
  items: NewsItem[],
  model?: string,
): Promise<string> {
  const lines = items
    .map((i) => `- [${i.source}] ${i.title}: ${i.summary}`)
    .join("\n");
  const prompt = `Here are today's top news stories:\n\n${lines}\n\nWrite a brief 3-4 sentence overall news digest.`;
  const result = await provider.chat([{ role: "user", content: prompt }], { model });
  return result.text;
}
