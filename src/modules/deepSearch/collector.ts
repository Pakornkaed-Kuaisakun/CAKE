// src/modules/deepSearch/collector.ts
//
// Runs sub-queries in parallel, deduplicates results by URL,
// and returns a flat list of unique hits.

import { search } from "../search/index.js";
import type { SubQuery, SearchHit } from "./types.js";

export async function collectHits(
  subQueries: SubQuery[],
  resultsPerQuery: number,
  onProgress?: (query: string, index: number, total: number) => void,
): Promise<SearchHit[]> {
  const allHits: SearchHit[] = [];
  const seenUrls = new Set<string>();

  // Run all searches in parallel
  const tasks = subQueries.map(async (sq, i) => {
    onProgress?.(sq.question, i + 1, subQueries.length);

    try {
      const results = await search(sq.question);
      const hits: SearchHit[] = results.slice(0, resultsPerQuery).map((r) => ({
        query: sq.question,
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
      }));
      return hits;
    } catch {
      return [];
    }
  });

  const batches = await Promise.all(tasks);

  for (const batch of batches) {
    for (const hit of batch) {
      if (hit.url && !seenUrls.has(hit.url)) {
        seenUrls.add(hit.url);
        allHits.push(hit);
      }
    }
  }

  return allHits;
}
