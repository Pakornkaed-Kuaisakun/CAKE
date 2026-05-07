import Parser from "rss-parser";
// import { env } from "../../config/env.js";
import { FEEDS } from "./fetchHelper/feeds.js";
import { normalizeArticles } from "./fetchHelper/normalize.js";
import { dedupeArticles } from "./fetchHelper/dedupe.js";
import { rankArticles } from "./fetchHelper/ranking.js";
import type { RawArticle } from "./fetchHelper/types.js";

const parser = new Parser({ timeout: 10000 });

export async function fetchFeeds(
  maxArticles = 20,
  topic?: string,
): Promise<RawArticle[]> {
  let selected = FEEDS;
  if (topic) {
    const categoryFeeds = FEEDS.filter(
      (f) => f.category === topic.toLocaleLowerCase(),
    );
    if (categoryFeeds.length > 0) {
      selected = categoryFeeds;
    }
  }

  const results = await Promise.allSettled(
    selected.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);

        return parsed.items.map((item) => ({
          title: item.title ?? "No title",
          source: feed.name,
          link: item.link ?? "",
          content: item.contentSnippet ?? item.content ?? "",
          publishedAt: item.pubDate,
          category: feed.category,
        }));
      } catch (error) {
        console.error(`[RSS ERROR] Failed to fetch feed ${feed.name}`, error);
        return [];
      }
    }),
  );

  let articles: RawArticle[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      articles.push(...result.value);
    }
  }

  articles = articles.map(normalizeArticles);

  if (topic) {
    const lower = topic.toLocaleLowerCase();

    articles = articles.filter(
      (a) =>
        a.title.toLocaleLowerCase().includes(lower) ||
        a.content.toLocaleLowerCase().includes(lower) ||
        a.category === lower,
    );
  }

  articles = dedupeArticles(articles);

  articles = rankArticles(articles, topic);

  return articles.slice(0, maxArticles);
}
