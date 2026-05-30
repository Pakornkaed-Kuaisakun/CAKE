import type { AIProvider } from "../../providers/types.js";
import type { BatchRequest } from "../../providers/batch-types.js";
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
  const result = await provider.chat([{ role: "user", content: prompt }], {
    model,
  });
  return {
    title: article.title,
    source: article.source,
    link: article.link,
    summary: result.text,
  };
}

/**
 * Summarize multiple articles.
 *
 * FIX: Uses Batch API (50% cost saving) when the provider supports it.
 * Falls back to Promise.all for providers without batch support.
 *
 * Previously, batch logic only existed inline in handleNews.ts,
 * so any direct caller of summarizeAll (Discord, tests, etc.)
 * always paid full per-request pricing.
 */
export async function summarizeAll(
  provider: AIProvider,
  articles: RawArticle[],
  model?: string,
): Promise<NewsItem[]> {
  if (articles.length === 0) return [];

  // Use Batch API if provider supports it — works for Claude, OpenAI, Gemini
  const batchProvider = provider as any;
  if (typeof batchProvider.runBatch === "function") {
    return summarizeAllBatch(provider, articles, model);
  }

  // Fallback: parallel individual requests
  return Promise.all(articles.map((a) => summarizeArticle(provider, a, model)));
}

async function summarizeAllBatch(
  provider: AIProvider,
  articles: RawArticle[],
  model?: string,
): Promise<NewsItem[]> {
  const batchProvider = provider as any;

  const requests: BatchRequest[] = articles.map((article, i) => ({
    customId: `article-${i}`,
    messages: [
      {
        role: "user" as const,
        content: `Summarize this news article in 1-2 sentences:\n\nTitle: ${article.title}\n\n${article.content.slice(0, 1500)}`,
      },
    ],
    options: { model },
  }));

  let responses: Array<{ customId: string; result: any; error?: string }>;
  try {
    responses = await batchProvider.runBatch(requests, { intervalMs: 2000 });
  } catch {
    // Batch failed — fall back to individual calls
    return Promise.all(
      articles.map((a) => summarizeArticle(provider, a, model)),
    );
  }

  // Build a lookup map so we can correlate responses back to articles
  // regardless of the order the batch returns them
  const responseMap = new Map(responses.map((r) => [r.customId, r]));

  return articles.map((article, i) => {
    const response = responseMap.get(`article-${i}`);
    const summary =
      response?.result?.text?.trim() ||
      response?.error ||
      "No summary available.";

    return {
      title: article.title,
      source: article.source,
      link: article.link,
      summary,
    };
  });
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
  const result = await provider.chat([{ role: "user", content: prompt }], {
    model,
  });
  return result.text;
}
