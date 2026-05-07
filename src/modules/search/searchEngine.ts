export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

/** DuckDuckGo Instant Answer API */
async function searchDDG(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const results: SearchResult[] = [];

  if (data.AbstractText) {
    results.push({
      title: data.AbstractSource ?? "DuckDuckGo",
      url: data.AbstractURL ?? "",
      snippet: data.AbstractText,
      source: "DuckDuckGo",
    });
  }

  for (const topic of data.RelatedTopics ?? []) {
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text.slice(0, 80),
        url: topic.FirstURL,
        snippet: topic.Text,
        source: "DuckDuckGo",
      });
    }
    if (results.length >= 5) break;
  }

  return results;
}

/** Wikipedia search API */
async function searchWikipedia(query: string): Promise<SearchResult[]> {
  const url =
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    title?: string;
    extract?: string;
    content_urls?: { desktop?: { page?: string } };
  };
  if (!data.extract) return [];
  return [
    {
      title: data.title ?? query,
      url: data.content_urls?.desktop?.page ?? "",
      snippet: data.extract.slice(0, 600),
      source: "Wikipedia",
    },
  ];
}

/**
 * Multi-source search: DuckDuckGo + Wikipedia in parallel.
 * Deduplicates by URL and returns up to 8 results.
 */
export async function search(query: string): Promise<SearchResult[]> {
  const [ddg, wiki] = await Promise.allSettled([
    searchDDG(query),
    searchWikipedia(query),
  ]);

  const combined: SearchResult[] = [];
  if (wiki.status === "fulfilled") combined.push(...wiki.value);
  if (ddg.status === "fulfilled") combined.push(...ddg.value);

  // Deduplicate by URL
  const seen = new Set<string>();
  return combined.filter((r) => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  }).slice(0, 8);
}
