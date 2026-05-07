import type { RawArticle } from "./types.js";

export function dedupeArticles(articles: RawArticle[]): RawArticle[] {
  const seen = new Set<string>();

  return articles.filter((a) => {
    const key = a.title.toLocaleLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}
