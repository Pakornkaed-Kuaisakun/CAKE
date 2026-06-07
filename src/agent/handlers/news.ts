import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  fetchFeeds,
  summarizeArticle,
  buildDigest,
  extractTopic,
} from "../../modules/news/index.js";
import { formatChatResult } from "../../shared/utils/utils.js";
import { getFastModel } from "../../providers/utils.js";

export async function handleNews(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  // 1. Extract topic using fast model
  const fastModel = model || getFastModel(provider.name);
  const topic = await extractTopic(input, provider, fastModel);
  const topicLabel = topic || "general";

  // 2. Fetch news based on topic
  const maxPerFeed = topic ? 5 : 2; // If specific topic, get more from each relevant feed
  const articles = await fetchFeeds(maxPerFeed, topicLabel);

  if (articles.length === 0) {
    return formatChatResult(
      `I couldn't find any recent news${topic ? ` about "${topicLabel}"` : ""}. Try a different topic?`,
    );
  }

  // 3. Summarize and build digest (utilizing Batch API for Claude Provider for 50% cost savings)
  const sliced = articles.slice(0, 10);
  let items: import("../../modules/news/summarize.js").NewsItem[] = [];

  if (
    provider.name === "claude" &&
    typeof (provider as any).runBatch === "function"
  ) {
    const batchRequests = sliced.map((a, i) => ({
      customId: `article-${i}`,
      messages: [
        {
          role: "user" as const,
          content: `Summarize this news article in 1-2 sentences:\n\nTitle: ${a.title}\n\n${a.content.slice(0, 1500)}`,
        },
      ],
      options: { model },
    }));

    try {
      const batchResults = await (provider as any).runBatch(batchRequests, {
        intervalMs: 2000,
      });
      items = sliced.map((a, i) => {
        const res = batchResults.find(
          (r: any) => r.customId === `article-${i}`,
        );
        return {
          title: a.title,
          source: a.source,
          link: a.link,
          summary: res?.result?.text || "No summary available.",
        };
      });
    } catch {
      // Fallback
      items = await Promise.all(
        sliced.map((a) => summarizeArticle(provider, a, model)),
      );
    }
  } else {
    items = await Promise.all(
      sliced.map((a) => summarizeArticle(provider, a, model)),
    );
  }

  const digest = await buildDigest(provider, items, model);
  const list = items.map((i) => `  • [${i.source}] ${i.title}`).join("\n");

  const title = topic
    ? `[NEWS] ${topic.toUpperCase()} Digest`
    : "[NEWS] General Digest";
  return formatChatResult(`${title}\n\n${digest}\n\nSources:\n${list}`);
}
