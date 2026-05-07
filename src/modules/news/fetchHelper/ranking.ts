import type { RawArticle } from "./types.js";

export function rankArticles(
  articles: RawArticle[],
  topic?: string,
): RawArticle[] {
  return articles
    .map((article) => {
      let score = 0;
      if (topic) {
        const lower = topic.toLocaleLowerCase();

        if (article.title.toLocaleLowerCase().includes(lower)) {
          score += 5;
        }

        if (article.content.toLocaleLowerCase().includes(lower)) {
          score += 2;
        }
      }

      return {
        ...article,
        score,
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
