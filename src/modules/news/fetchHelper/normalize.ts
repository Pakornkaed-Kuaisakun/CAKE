import type { RawArticle } from "./types.js";

export function normalizeArticles(article: RawArticle): RawArticle {
  return {
    ...article,

    title: article.title.replace(/\s+/g, " ").trim(),
    content: article.content
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  };
}
