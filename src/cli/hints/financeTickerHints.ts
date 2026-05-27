// src/cli/hints/financeTickerHints.ts
//
// Fetches a list of popular/trending stock tickers from Yahoo Finance's
// free search/trending APIs, caches them to ~/.cake/cache/tickers.json
// (24-hour TTL), and returns them for autocomplete.
//
// APIs used (no key required):
//   1. Yahoo Finance trending tickers:
//      GET https://query1.finance.yahoo.com/v1/finance/trending/US
//   2. Yahoo Finance search (for query-based lookup):
//      GET https://query1.finance.yahoo.com/v1/finance/search?q=<query>&quotesCount=8
//
// The hook layer (useFinanceTickers) calls these at the right React lifecycle
// moments and keeps the cache warm.

import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";
import YahooFinance from "yahoo-finance2/src/index.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export interface TickerHint {
  symbol: string;
  name: string;
  /** e.g. "EQUITY", "ETF", "INDEX" */
  type: string;
  /** e.g. "NMS", "NYQ" */
  exchange: string;
}

interface TickerCache {
  /** ISO date string — cache is valid for 24h */
  fetchedAt: string;
  tickers: TickerHint[];
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(CAKE_DIR, "cache");
const CACHE_FILE = path.join(CACHE_DIR, "tickers.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Curated fallback list ─────────────────────────────────────────────────────
// Used when both API calls fail (offline, rate-limited, etc.)

export const FALLBACK_TICKERS: TickerHint[] = [
  { symbol: "AAPL", name: "Apple Inc.", type: "EQUITY", exchange: "NMS" },
  {
    symbol: "MSFT",
    name: "Microsoft Corporation",
    type: "EQUITY",
    exchange: "NMS",
  },
  { symbol: "GOOGL", name: "Alphabet Inc.", type: "EQUITY", exchange: "NMS" },
  { symbol: "AMZN", name: "Amazon.com Inc.", type: "EQUITY", exchange: "NMS" },
  {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    type: "EQUITY",
    exchange: "NMS",
  },
  {
    symbol: "META",
    name: "Meta Platforms Inc.",
    type: "EQUITY",
    exchange: "NMS",
  },
  { symbol: "TSLA", name: "Tesla Inc.", type: "EQUITY", exchange: "NMS" },
  { symbol: "NFLX", name: "Netflix Inc.", type: "EQUITY", exchange: "NMS" },
  {
    symbol: "AMD",
    name: "Advanced Micro Devices",
    type: "EQUITY",
    exchange: "NMS",
  },
  {
    symbol: "INTC",
    name: "Intel Corporation",
    type: "EQUITY",
    exchange: "NMS",
  },
  {
    symbol: "JPM",
    name: "JPMorgan Chase & Co.",
    type: "EQUITY",
    exchange: "NYQ",
  },
  {
    symbol: "BAC",
    name: "Bank of America Corp.",
    type: "EQUITY",
    exchange: "NYQ",
  },
  {
    symbol: "GS",
    name: "Goldman Sachs Group",
    type: "EQUITY",
    exchange: "NYQ",
  },
  { symbol: "V", name: "Visa Inc.", type: "EQUITY", exchange: "NYQ" },
  { symbol: "MA", name: "Mastercard Inc.", type: "EQUITY", exchange: "NYQ" },
  { symbol: "WMT", name: "Walmart Inc.", type: "EQUITY", exchange: "NYQ" },
  {
    symbol: "DIS",
    name: "Walt Disney Company",
    type: "EQUITY",
    exchange: "NYQ",
  },
  {
    symbol: "PYPL",
    name: "PayPal Holdings Inc.",
    type: "EQUITY",
    exchange: "NMS",
  },
  { symbol: "CRM", name: "Salesforce Inc.", type: "EQUITY", exchange: "NYQ" },
  { symbol: "ADBE", name: "Adobe Inc.", type: "EQUITY", exchange: "NMS" },
  {
    symbol: "ORCL",
    name: "Oracle Corporation",
    type: "EQUITY",
    exchange: "NYQ",
  },
  { symbol: "IBM", name: "IBM Corporation", type: "EQUITY", exchange: "NYQ" },
  { symbol: "QCOM", name: "Qualcomm Inc.", type: "EQUITY", exchange: "NMS" },
  { symbol: "AVGO", name: "Broadcom Inc.", type: "EQUITY", exchange: "NMS" },
  {
    symbol: "TSM",
    name: "Taiwan Semiconductor",
    type: "EQUITY",
    exchange: "NYQ",
  },
  {
    symbol: "XOM",
    name: "Exxon Mobil Corporation",
    type: "EQUITY",
    exchange: "NYQ",
  },
  {
    symbol: "CVX",
    name: "Chevron Corporation",
    type: "EQUITY",
    exchange: "NYQ",
  },
  { symbol: "PFE", name: "Pfizer Inc.", type: "EQUITY", exchange: "NYQ" },
  { symbol: "JNJ", name: "Johnson & Johnson", type: "EQUITY", exchange: "NYQ" },
  {
    symbol: "LLY",
    name: "Eli Lilly and Company",
    type: "EQUITY",
    exchange: "NYQ",
  },
  {
    symbol: "UNH",
    name: "UnitedHealth Group",
    type: "EQUITY",
    exchange: "NYQ",
  },
  {
    symbol: "PG",
    name: "Procter & Gamble Co.",
    type: "EQUITY",
    exchange: "NYQ",
  },
  { symbol: "KO", name: "Coca-Cola Company", type: "EQUITY", exchange: "NYQ" },
  { symbol: "PEP", name: "PepsiCo Inc.", type: "EQUITY", exchange: "NMS" },
  { symbol: "SHOP", name: "Shopify Inc.", type: "EQUITY", exchange: "NYQ" },
  {
    symbol: "SPOT",
    name: "Spotify Technology",
    type: "EQUITY",
    exchange: "NYQ",
  },
  {
    symbol: "UBER",
    name: "Uber Technologies Inc.",
    type: "EQUITY",
    exchange: "NYQ",
  },
  { symbol: "ABNB", name: "Airbnb Inc.", type: "EQUITY", exchange: "NMS" },
  {
    symbol: "PLTR",
    name: "Palantir Technologies",
    type: "EQUITY",
    exchange: "NYQ",
  },
  {
    symbol: "COIN",
    name: "Coinbase Global Inc.",
    type: "EQUITY",
    exchange: "NMS",
  },
  { symbol: "SNOW", name: "Snowflake Inc.", type: "EQUITY", exchange: "NYQ" },
  {
    symbol: "CRWD",
    name: "CrowdStrike Holdings",
    type: "EQUITY",
    exchange: "NMS",
  },
  { symbol: "DDOG", name: "Datadog Inc.", type: "EQUITY", exchange: "NMS" },
  { symbol: "NET", name: "Cloudflare Inc.", type: "EQUITY", exchange: "NYQ" },
  { symbol: "SQ", name: "Block Inc.", type: "EQUITY", exchange: "NYQ" },
  {
    symbol: "HOOD",
    name: "Robinhood Markets Inc.",
    type: "EQUITY",
    exchange: "NMS",
  },
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    type: "ETF",
    exchange: "PCX",
  },
  { symbol: "QQQ", name: "Invesco QQQ Trust", type: "ETF", exchange: "NMS" },
  { symbol: "DIA", name: "SPDR Dow Jones ETF", type: "ETF", exchange: "PCX" },
  { symbol: "GLD", name: "SPDR Gold Shares ETF", type: "ETF", exchange: "PCX" },
  { symbol: "BTC-USD", name: "Bitcoin USD", type: "CRYPTO", exchange: "CCC" },
  { symbol: "ETH-USD", name: "Ethereum USD", type: "CRYPTO", exchange: "CCC" },
];

// ── Disk cache helpers ────────────────────────────────────────────────────────

function loadCache(): TickerHint[] | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as TickerCache;
    const age = Date.now() - new Date(raw.fetchedAt).getTime();
    if (age > CACHE_TTL_MS) return null; // expired
    if (!Array.isArray(raw.tickers) || raw.tickers.length === 0) return null;
    return raw.tickers;
  } catch {
    return null;
  }
}

function saveCache(tickers: TickerHint[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const payload: TickerCache = {
      fetchedAt: new Date().toISOString(),
      tickers,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // non-fatal
  }
}

// ── Yahoo Finance API helpers ─────────────────────────────────────────────────

export const YF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",

  Accept: "application/json, text/plain, */*",

  "Accept-Language": "en-US,en;q=0.9",

  Referer: "https://finance.yahoo.com/",

  Origin: "https://finance.yahoo.com",

  Connection: "keep-alive",
};

/** Fetch US trending tickers from Yahoo Finance */
async function fetchTrending(): Promise<TickerHint[]> {
  const url =
    "https://query1.finance.yahoo.com/v1/finance/trending/US?count=40&useQuotes=true";
  const res = await fetch(url, {
    headers: YF_HEADERS,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data: any = await res.json();
  const quotes: any[] = data?.finance?.result?.[0]?.quotes ?? [];

  return quotes
    .filter((q) => q.symbol && typeof q.symbol === "string")
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortName ?? q.longName ?? q.symbol,
      type: q.quoteType ?? "EQUITY",
      exchange: q.exchange ?? q.fullExchangeName ?? "",
    }));
}

/**
 * Fetch quotes detail for a batch of symbols to enrich with names.
 * Uses Yahoo Finance /v7/finance/quote endpoint (no key needed).
 */
async function fetchQuoteDetails(symbols: string[]): Promise<TickerHint[]> {
  if (symbols.length === 0) {
    return [];
  }

  try {
    const uniqueSymbols = [...new Set(symbols)].slice(0, 50);

    const quotes = await Promise.all(
      uniqueSymbols.map((symbol) => yahooFinance.quote(symbol)),
    );

    return quotes
      .filter((q) => q?.symbol)
      .map((q) => ({
        symbol: q.symbol,

        name: q.shortName ?? q.longName ?? q.symbol,

        type: q.quoteType ?? "EQUITY",

        exchange: q.exchange ?? q.fullExchangeName ?? "",
      }));
  } catch {
    return [];
  }
}

/**
 * Search Yahoo Finance for tickers matching a query string.
 * Used for live filtering as the user types a partial symbol.
 */
export async function searchTickers(query: string): Promise<TickerHint[]> {
  if (!query || query.length < 1) return [];
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0`;
    const res = await fetch(url, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const quotes: any[] = data?.quotes ?? [];

    return quotes
      .filter((q) => q.symbol && q.quoteType !== "NONE")
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortname ?? q.longname ?? q.symbol,
        type: q.quoteType ?? "EQUITY",
        exchange: q.exchange ?? q.exchDisp ?? "",
      }));
  } catch {
    return [];
  }
}

// ── Main fetch function ───────────────────────────────────────────────────────

/**
 * Returns tickers for the autocomplete popup.
 * Priority:
 *   1. Disk cache (< 24h old)
 *   2. Yahoo Finance trending API
 *   3. Curated fallback list
 *
 * Always resolves — never throws.
 */
export async function fetchTickerHints(): Promise<TickerHint[]> {
  // 1. Cache hit
  const cached = loadCache();
  if (cached) return cached;

  // 2. Fetch trending from Yahoo Finance
  try {
    const trending = await fetchTrending();

    // Enrich with names via quote details if trending returned bare symbols
    const needsNames = trending.filter((t) => t.name === t.symbol);
    if (needsNames.length > 0) {
      const detailed = await fetchQuoteDetails(needsNames.map((t) => t.symbol));
      const nameMap = new Map(detailed.map((d) => [d.symbol, d]));
      for (const t of trending) {
        const detail = nameMap.get(t.symbol);
        if (detail) {
          t.symbol = detail.symbol;
          t.name = detail.name;
          t.type = detail.type;
          t.exchange = detail.exchange;
        }
      }
    }

    // Merge: trending first, then fill to 60 from fallback
    const trendingSymbols = new Set(trending.map((t) => t.symbol));
    const extra = FALLBACK_TICKERS.filter(
      (t) => !trendingSymbols.has(t.symbol),
    );
    const merged = [...trending, ...extra].slice(0, 80);

    saveCache(merged);
    return merged;
  } catch {
    // 3. API failed → fallback list (also cache it briefly)
    saveCache(FALLBACK_TICKERS);
    return FALLBACK_TICKERS;
  }
}
