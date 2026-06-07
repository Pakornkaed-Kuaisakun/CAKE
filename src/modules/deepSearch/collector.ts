// src/modules/deepSearch/collector.ts
//
// Runs sub-queries in parallel, deduplicates results by URL,
// and returns a flat list of unique hits.

import { search } from "../search/index.js";
import type { SubQuery, SearchHit } from "./types.js";
import {
  getCache,
  loadFromDisk,
  saveToDisk,
  setCache,
} from "../search/cache.js";
import type { AIProvider } from "../../providers/types.js";
import { ingestText } from "../vectordb/manager.js";
import {
  updateDeepSearchRun,
  updateDeepSearchTimelineEntry,
} from "./monitor.js";
import { batchRun } from "../../shared/utils/utils.js";

/**
 * BUG FIX: The original batchRun had a race condition where reject() could be
 * called by one task while other tasks were still running and calling runNext().
 * After reject(), the Promise was already settled, but the remaining runNext()
 * calls continued executing and eventually called resolve() — which is a no-op
 * on an already-settled Promise, but the finally block still mutated `completed`
 * and called runNext() causing unnecessary work and potential hangs if the
 * error path and the completion path raced.
 *
 * Fix: introduce an `aborted` flag. Once any task rejects, all subsequent
 * runNext() invocations exit immediately without launching new tasks or calling
 * resolve/reject again. In-flight tasks still complete (we can't cancel them)
 * but their results are discarded.
 */

export async function collectHits(
  provider: AIProvider | undefined,
  subQueries: SubQuery[],
  resultsPerQuery: number,
  maxConcurrentSubQueries: number,
  runId: string,
  onProgress?: (query: string, index: number, total: number) => void,
): Promise<SearchHit[]> {
  await loadFromDisk();
  const allHits: SearchHit[] = [];
  const seenUrls = new Set<string>();

  const tasks = subQueries.map((sq, i) => async () => {
    onProgress?.(sq.question, i + 1, subQueries.length);
    updateDeepSearchTimelineEntry(runId, `search-${i}`, {
      status: "running",
      startedAt: new Date().toISOString(),
      details: "Searching sub-query sources",
    });

    try {
      const results = await search(sq.question, {
        provider,
        maxResults: resultsPerQuery,
      });
      const hits: SearchHit[] = [];

      for (const r of results.slice(0, resultsPerQuery)) {
        const cached = getCache(r.url);
        if (!cached && provider?.embed) {
          try {
            const embedText = (r.summary || r.snippet || r.title).slice(0, 512);
            const embedding = await provider.embed(embedText);
            const fetchedAt = new Date().toISOString();
            setCache({
              url: r.url,
              summary: r.summary ?? r.snippet ?? r.title,
              sourceType: r.sourceType,
              embedding,
              metadata: { ...(r.metadata ?? {}), fetchedAt },
              fetchedAt,
            });
            try {
              await ingestText(
                provider as AIProvider,
                "search_cache",
                embedText,
                {
                  url: r.url,
                  title: r.title,
                  source: r.source,
                  sourceType: r.sourceType,
                  fetchedAt,
                },
              );
            } catch {
              // non-fatal
            }
          } catch {
            // ignore embed failures
          }
        }

        hits.push({
          query: sq.question,
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          source: r.source,
          summary: r.summary,
          sourceType: r.sourceType,
          relevance: r.relevance,
          hallucinationRisk: r.hallucinationRisk,
          metadata: r.metadata,
        });
      }

      updateDeepSearchTimelineEntry(runId, `search-${i}`, {
        status: "completed",
        completedAt: new Date().toISOString(),
        progressPct: 100,
        details: `Found ${hits.length} results for sub-query ${i + 1}`,
      });
      return hits;
    } catch (error) {
      updateDeepSearchTimelineEntry(runId, `search-${i}`, {
        status: "failed",
        completedAt: new Date().toISOString(),
        details: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });

  const batches = await batchRun(
    tasks,
    Math.max(1, Math.min(maxConcurrentSubQueries, subQueries.length)),
  );

  for (const batch of batches) {
    for (const hit of batch) {
      if (hit.url && !seenUrls.has(hit.url)) {
        seenUrls.add(hit.url);
        allHits.push(hit);
      }
    }
  }

  await saveToDisk();
  return allHits;
}
