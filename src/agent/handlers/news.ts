import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  fetchFeeds,
  summarizeArticle,
  buildDigest,
  extractTopic,
} from "../../modules/news/index.js";
import { text } from "../utils/text.js";
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
    return text(
      `I couldn't find any recent news${topic ? ` about "${topicLabel}"` : ""}. Try a different topic?`,
    );
  }

  // 3. Summarize and build digest
  const items = await Promise.all(
    articles.slice(0, 10).map((a) => summarizeArticle(provider, a, model)),
  );

  const digest = await buildDigest(provider, items, model);
  const list = items.map((i) => `  • [${i.source}] ${i.title}`).join("\n");

  const title = topic
    ? `[NEWS] ${topic.toUpperCase()} Digest`
    : "[NEWS] General Digest";
  return text(`${title}\n\n${digest}\n\nSources:\n${list}`);
}
