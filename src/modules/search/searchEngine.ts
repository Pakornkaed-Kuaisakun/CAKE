import Parser from "rss-parser";
import type { AIProvider } from "../../providers/types.js";
import stringSimilarity from "string-similarity";

export type SourceType =
  | "documentation"
  | "community"
  | "research"
  | "news"
  | "code"
  | "other";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  /** lightweight summary only (no full HTML/README/RSS) */
  summary?: string;
  /** classification of source */
  sourceType?: SourceType;
  /** relevance score (0..1) computed from multiple signals */
  relevance?: number;
  /** hallucination risk estimate (0..1) */
  hallucinationRisk?: number;
  /** metadata for caching and provenance (host, fetchedAt) */
  metadata?: Record<string, any>;
}

const parser = new Parser();

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** DuckDuckGo Instant Answer API */
async function searchDDG(query: string, timeoutMs: number): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
  const res = await fetchWithTimeout(url, timeoutMs);
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

/** Wikipedia summary API */
async function searchWikipediaSummary(query: string, timeoutMs: number): Promise<SearchResult[]> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, timeoutMs);
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

/** Wikipedia search API */
async function searchWikipediaPages(query: string, timeoutMs: number): Promise<SearchResult[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=4`;
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: { search?: Array<{ title?: string; snippet?: string }> };
  };
  return (data.query?.search ?? [])
    .slice(0, 4)
    .map((item) => ({
      title: item.title ?? query,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(
        item.title?.replace(/\s/g, "_") ?? query,
      )}`,
      snippet: stripHtml(item.snippet ?? "").slice(0, 400),
      source: "Wikipedia",
    }));
}

/** Google News RSS search */
async function searchGoogleNews(query: string, timeoutMs: number): Promise<SearchResult[]> {
  try {
    const feed = await parser.parseURL(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
    );
    return (feed.items ?? [])
      .slice(0, 5)
      .map((item) => ({
        title: item.title ?? query,
        url: item.link ?? "",
        snippet: stripHtml(item.contentSnippet ?? item.content ?? "").slice(0, 400),
        source: "Google News",
      }))
      .filter((result) => !!result.url);
  } catch {
    return [];
  }
}

/** Reddit search results */
async function searchReddit(query: string, timeoutMs: number): Promise<SearchResult[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=5&sort=relevance&t=all`;
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) return [];
    const data = await res.json() as {
      data?: { children?: Array<{ data?: any }> };
    };
    return (data.data?.children ?? [])
      .map((child) => child.data)
      .filter(Boolean)
      .map((item) => ({
        title: item.title ?? query,
        url: item.url?.startsWith("http")
          ? item.url
          : `https://www.reddit.com${item.permalink ?? ""}`,
        snippet: stripHtml(
          [item.selftext, item.title, item.subreddit_name_prefixed]
            .filter(Boolean)
            .join(" | "),
        ).slice(0, 400),
        source: "Reddit",
      }))
      .filter((result) => !!result.url);
  } catch {
    return [];
  }
}

/** StackOverflow search results */
async function searchStackOverflow(query: string, timeoutMs: number): Promise<SearchResult[]> {
  try {
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(
      query,
    )}&site=stackoverflow&pagesize=4&filter=!)remlp0kFHmf1EFKfzXT`;
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) return [];
    const data = await res.json() as {
      items?: Array<{ title?: string; link?: string; tags?: string[]; is_answered?: boolean }>; 
    };
    return (data.items ?? [])
      .slice(0, 4)
      .map((item) => ({
        title: item.title ?? query,
        url: item.link ?? "",
        snippet: [`Tags: ${item.tags?.join(", ")}`, item.is_answered ? "Answered" : "Unanswered"]
          .filter(Boolean)
          .join(" | "),
        source: "StackOverflow",
      }))
      .filter((result) => !!result.url);
  } catch {
    return [];
  }
}

/**
 * Multi-source search: DuckDuckGo, Wikipedia, Google News, Reddit, and StackOverflow.
 * Deduplicates by URL and returns up to 12 results.
 */
/**
 * A small fetch wrapper with timeout (async timeout protection).
 */
async function fetchWithTimeout(input: string | URL, ms = 6000, init?: RequestInit) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(input, { signal: controller.signal, ...init });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function classifySourceType(url: string, sourceLabel?: string): SourceType {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host.includes("wikipedia")) return "research";
    if (host.includes("github") || host.includes("npmjs")) return "code";
    if (host.includes("reddit") || host.includes("stackexchange") || host.includes("stackoverflow")) return "community";
    if (host.includes("news") || host.includes("cnn") || host.includes("bbc") || sourceLabel === "Google News") return "news";
    if (host.includes("docs") || sourceLabel?.toLowerCase?.().includes("docs")) return "documentation";
  } catch {
    // ignore
  }
  return "other";
}

function computeKeywordOverlap(query: string, text: string): number {
  const qWords = query.toLowerCase().split(/\W+/).filter(Boolean);
  const t = text.toLowerCase();
  if (qWords.length === 0) return 0;
  let hits = 0;
  for (const w of qWords) if (t.includes(w)) hits++;
  return hits / qWords.length;
}

function titleSimilarity(query: string, title: string): number {
  return stringSimilarity.compareTwoStrings(query || "", title || "");
}

function freshnessScore(fetchedAt?: string): number {
  if (!fetchedAt) return 0.5;
  try {
    const ageMs = Date.now() - new Date(fetchedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // exponential decay with 14-day half-life-ish behavior
    return Math.max(0, Math.exp(-ageDays / 14));
  } catch {
    return 0.5;
  }
}

function computeFinalRelevance(kOverlap: number, tSim: number, semantic = 0, fresh = 0.5): number {
  // weights: keyword 25%, title 15%, semantic 45%, freshness 15%
  const score = kOverlap * 0.25 + tSim * 0.15 + semantic * 0.45 + fresh * 0.15;
  return Math.min(1, Math.max(0, score));
}

async function semanticRerank(provider: AIProvider | undefined, query: string, hits: SearchResult[]): Promise<Record<string, number>> {
  const scores: Record<string, number> = {};
  if (!provider || !provider.embed) return scores;

  try {
    const qVec = await provider.embed(query);
    const texts = hits.map((h) => (h.summary || h.snippet || h.title).slice(0, 1000));
    const vecs = await Promise.all(texts.map((t) => provider.embed!(t)));
    const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
    const norm = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const qn = norm(qVec) || 1;
    for (let i = 0; i < hits.length; i++) {
      const v = vecs[i];
      const sim = qn && v ? dot(qVec, v) / (qn * (norm(v) || 1)) : 0;
      scores[hits[i].url] = sim;
    }
  } catch {
    // embedding failure — skip semantic rerank
  }

  return scores;
}

/**
 * Multi-source search: DuckDuckGo, Wikipedia, Google News, Reddit, and StackOverflow.
 * Deduplicates by URL and returns up to `maxResults` results. Optionally accepts
 * a provider for semantic reranking and embedding generation.
 */
export async function search(query: string, options?: { provider?: AIProvider; maxResults?: number; timeoutMs?: number; }): Promise<SearchResult[]> {
  const provider = options?.provider;
  const maxResults = options?.maxResults ?? 12;
  const timeoutMs = options?.timeoutMs ?? 6000;

  const results = await Promise.allSettled([
    searchDDG(query, timeoutMs),
    searchWikipediaSummary(query, timeoutMs),
    searchWikipediaPages(query, timeoutMs),
    searchGoogleNews(query, timeoutMs),
    searchReddit(query, timeoutMs),
    searchStackOverflow(query, timeoutMs),
  ]);

  const combined: SearchResult[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      combined.push(...result.value);
    }
  }

  // Add provenance metadata and lightweight summaries, classify types
  const enhanced = combined.map((r) => {
    const urlHost = (() => {
      try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; }
    })();
    const summary = (r.snippet || r.title || "").slice(0, 400);
    const sourceType = classifySourceType(r.url, r.source);
    const metadata = { host: urlHost, fetchedAt: new Date().toISOString() };
    return { ...r, summary, sourceType, metadata } as SearchResult;
  });

  // dedupe
  const seen = new Set<string>();
  const deduped = enhanced.filter((r) => {
    if (!r.url) return false;
    const normalizedUrl = r.url.split("#")[0];
    if (seen.has(normalizedUrl)) return false;
    seen.add(normalizedUrl);
    return true;
  });

  // semantic rerank
  const semanticScores = await semanticRerank(provider, query, deduped.slice(0, 50));

  // compute combined relevance and hallucination estimate
  for (const r of deduped) {
    const k = computeKeywordOverlap(query, (r.summary || r.snippet || ""));
    const t = titleSimilarity(query, r.title || "");
    const s = semanticScores[r.url] ?? 0;
    const fresh = freshnessScore(r.metadata?.fetchedAt ?? undefined);
    r.relevance = computeFinalRelevance(k, t, s, fresh);
    // hallucination risk heuristic: low if authoritative sourceType/relevance high
    const baseRisk = 1 - r.relevance;
    const typeAdj = r.sourceType === "documentation" || r.sourceType === "research" ? -0.3 : 0;
    r.hallucinationRisk = Math.max(0, Math.min(1, baseRisk + typeAdj));
  }

  // sort by relevance desc
  deduped.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

  return deduped.slice(0, maxResults);
}
