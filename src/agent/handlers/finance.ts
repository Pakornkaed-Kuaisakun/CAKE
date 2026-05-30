// src/agent/handlers/finance.ts
//
// Improved finance handler — richer analysis, better output, streaming progress.
//
// Features vs original:
//   • Multi-section report in the terminal (price, fundamentals, technicals, AI analysis)
//   • Fetches 52-week range, volume, analyst targets, dividend info, beta
//   • Structured text output (no PDF dependency for quick queries)
//   • Optional PDF export via --pdf flag
//   • Better ticker extraction (handles "AAPL stock", "Apple AAPL", "$MSFT", etc.)
//   • Real-time streaming progress via RunOptions.onChunk
//   • Graceful error messages with suggestions

import {
  fetchStockData,
  fetchEnhancedStockData,
  analyzeStock,
  generateReport,
  formatCurrency,
  formatLargeNumber,
  formatPct,
} from "../../modules/finance/index.js";
import {
  guardOperation,
  getPermissionLevel,
  type PermissionDecision,
  type PermissionRequest,
} from "../../agent/permissions/index.js";
import type { ChatResult, AIProvider } from "../../providers/types.js";
import type { RunOptions } from "../index.js";
import { text } from "../utils/text.js";

// ── Common English stop words that are never tickers ─────────────────────────
const STOP_WORDS = new Set([
  "PLEASE",
  "VALID",
  "STOCK",
  "STOCKS",
  "REPORT",
  "FINANCE",
  "FINANCIAL",
  "MARKET",
  "GET",
  "SHOW",
  "FOR",
  "THE",
  "AND",
  "OR",
  "OF",
  "DATA",
  "INFO",
  "ABOUT",
  "PRICE",
  "CHECK",
  "GIVE",
  "ME",
  "MY",
  "WHAT",
  "IS",
  "ARE",
  "HOW",
  "DO",
  "DOES",
  "DID",
  "CAN",
  "WILL",
  "WOULD",
  "SHOULD",
  "HAS",
  "HAVE",
  "ANALYSIS",
  "ANALYZE",
  "ANALYSE",
  "CURRENT",
  "LATEST",
  "TODAY",
  "NOW",
  "TICKER",
  "SYMBOL",
  "QUOTE",
  "TRADE",
  "TRADING",
  "BUY",
  "SELL",
  "HOLD",
  "SUMMARY",
  "OVERVIEW",
  "DETAIL",
  "DETAILS",
  "TELL",
  "USE",
  "RUN",
  "FIND",
  "LIST",
  "VIEW",
]);

// Mapping of common company names → tickers for fuzzy matching
const COMPANY_TO_TICKER: Record<string, string> = {
  apple: "AAPL",
  microsoft: "MSFT",
  google: "GOOGL",
  alphabet: "GOOGL",
  amazon: "AMZN",
  meta: "META",
  facebook: "META",
  netflix: "NFLX",
  tesla: "TSLA",
  nvidia: "NVDA",
  amd: "AMD",
  intel: "INTC",
  "berkshire hathaway": "BRK.B",
  jpmorgan: "JPM",
  "jp morgan": "JPM",
  "bank of america": "BAC",
  wells: "WFC",
  goldman: "GS",
  morgan: "MS",
  disney: "DIS",
  walmart: "WMT",
  "home depot": "HD",
  visa: "V",
  mastercard: "MA",
  paypal: "PYPL",
  salesforce: "CRM",
  adobe: "ADBE",
  oracle: "ORCL",
  ibm: "IBM",
  qualcomm: "QCOM",
  broadcom: "AVGO",
  "taiwan semiconductor": "TSM",
  tsmc: "TSM",
  samsung: "SSNLF",
  exxon: "XOM",
  chevron: "CVX",
  "johnson & johnson": "JNJ",
  pfizer: "PFE",
  "eli lilly": "LLY",
  abbvie: "ABBV",
  unitedhealth: "UNH",
  "procter & gamble": "PG",
  "coca cola": "KO",
  pepsi: "PEP",
  "at&t": "T",
  verizon: "VZ",
  comcast: "CMCSA",
  shopify: "SHOP",
  spotify: "SPOT",
  uber: "UBER",
  airbnb: "ABNB",
  palantir: "PLTR",
  coinbase: "COIN",
  robinhood: "HOOD",
  snowflake: "SNOW",
  crowdstrike: "CRWD",
  datadog: "DDOG",
  "service now": "NOW",
  workday: "WDAY",
  "zoom video": "ZM",
  zoom: "ZM",
  square: "SQ",
  block: "SQ",
  twitter: "X",
  "s&p": "SPY",
  nasdaq: "QQQ",
  "dow jones": "DIA",
};

let _askHandler:
  | ((req: PermissionRequest) => Promise<PermissionDecision>)
  | null = null;

export function setReportAskHandler(
  fn: (req: PermissionRequest) => Promise<PermissionDecision>,
): void {
  _askHandler = fn;
}

async function defaultAskHandler(
  req: PermissionRequest,
): Promise<PermissionDecision> {
  if (!process.stdin.isTTY) return "deny";
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `\n⚠️  Permission required\n` +
        `   Operation : ${req.description}\n` +
        `   Detail    : ${req.detail}\n` +
        `   Allow? [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "y" ? "allow" : "deny");
      },
    );
  });
}

export function extractTicker(input: string): string | null {
  // 1. Explicit $TICKER format
  const dollarMatch = input.match(/\$([A-Z]{1,5}(?:\.[AB])?)\b/);
  if (dollarMatch) return dollarMatch[1];

  // 2. TICKER: format
  const colonMatch = input.match(/\b([A-Z]{1,5}(?:\.[AB])?):/);
  if (colonMatch) return colonMatch[1];

  // 3. Company name lookup
  const lower = input.toLowerCase();
  for (const [name, ticker] of Object.entries(COMPANY_TO_TICKER)) {
    if (lower.includes(name)) return ticker;
  }

  // 4. Isolated uppercase word (1–5 chars), skip stop words
  const words = input.toUpperCase().match(/\b[A-Z]{1,5}(?:\.[AB])?\b/g) ?? [];
  for (const word of words) {
    if (!STOP_WORDS.has(word)) return word;
  }

  return null;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function bar(value: number, max: number, width = 20): string {
  const filled = Math.round((Math.min(value, max) / max) * width);
  return (
    "█".repeat(Math.max(0, filled)) + "░".repeat(width - Math.max(0, filled))
  );
}

function sentimentBar(score: number): string {
  // score: -1 (bearish) to +1 (bullish)
  const normalized = (score + 1) / 2; // 0..1
  const pos = Math.round(normalized * 10);
  const neg = 10 - pos;
  return "🔴".repeat(neg) + "🟢".repeat(pos);
}

function changeArrow(change: number): string {
  if (change > 0) return `▲ +${formatPct(change)}`;
  if (change < 0) return `▼ ${formatPct(change)}`;
  return `● 0.00%`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleFinanceReport(
  provider: AIProvider,
  input: string,
  model?: string,
  options?: RunOptions,
): Promise<ChatResult> {
  const symbol = extractTicker(input);
  const wantPdf = /--pdf\b/i.test(input);

  if (!symbol) {
    return text(
      [
        "Please provide a stock ticker symbol.",
        "",
        "Examples:",
        "  finance AAPL",
        "  finance $TSLA",
        "  finance Microsoft",
        "  finance NVDA --pdf   (also saves a PDF report)",
        "",
        "Popular tickers: AAPL MSFT GOOGL AMZN NVDA META TSLA NFLX",
      ].join("\n"),
    );
  }

  const emit = (msg: string) => {
    if (options?.onChunk) options.onChunk(msg);
  };

  const SEP = "─".repeat(60);
  const WIDE = "═".repeat(60);

  emit(`[FINANCE] Fetching data for ${symbol}…\n`);

  let stock: any;
  try {
    stock = await fetchEnhancedStockData(symbol);
  } catch (err: any) {
    // Friendly error with suggestions
    const suggestion = COMPANY_TO_TICKER[symbol.toLowerCase()];
    const lines = [`❌ Could not fetch data for "${symbol}".`];
    if (err.message?.includes("No fundamentals")) {
      lines.push(`   "${symbol}" may be a crypto, ETF, or invalid ticker.`);
    } else {
      lines.push(`   ${err.message}`);
    }
    if (suggestion) lines.push(`   Did you mean: ${suggestion}?`);
    lines.push(
      ``,
      `Tip: Use the exact exchange symbol, e.g. "BRK.B" not "BERKSHIRE".`,
    );
    return text(lines.join("\n"));
  }

  emit(`[FINANCE] Running AI analysis…\n`);

  const analysis = await analyzeStock(provider, stock, model);

  // ── Build rich text report ─────────────────────────────────────────────────

  const priceChange = stock.regularMarketChange ?? 0;
  const priceChangePct = stock.regularMarketChangePercent ?? 0;
  const isPositive = priceChange >= 0;

  const lines: string[] = [
    "",
    WIDE,
    `  ${stock.shortName ?? symbol}  (${symbol})`,
    `  ${stock.exchange ?? ""}  •  ${stock.sector ?? ""}  •  ${stock.industry ?? ""}`,
    WIDE,
    "",

    // ── Price block ──────────────────────────────────────────────────────────
    `📈  PRICE`,
    SEP,
    `  Current Price   : ${formatCurrency(stock.price ?? 0, stock.currency)}`,
    `  Change (Day)    : ${changeArrow(priceChangePct)}  (${formatCurrency(Math.abs(priceChange), stock.currency)})`,
    `  52-Week Range   : ${formatCurrency(stock.fiftyTwoWeekLow ?? 0, stock.currency)} — ${formatCurrency(stock.fiftyTwoWeekHigh ?? 0, stock.currency)}`,
    ...(stock.fiftyTwoWeekLow && stock.fiftyTwoWeekHigh
      ? [
          `  Position in Range: [${bar(
            (stock.price ?? 0) - stock.fiftyTwoWeekLow,
            stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow,
          )}]  ${Math.round((((stock.price ?? 0) - stock.fiftyTwoWeekLow) / (stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow)) * 100)}%`,
        ]
      : []),
    `  50-Day MA       : ${stock.fiftyDayAverage ? formatCurrency(stock.fiftyDayAverage, stock.currency) : "N/A"}`,
    `  200-Day MA      : ${stock.twoHundredDayAverage ? formatCurrency(stock.twoHundredDayAverage, stock.currency) : "N/A"}`,
    `  Volume          : ${formatLargeNumber(stock.regularMarketVolume ?? 0)}`,
    `  Avg Volume      : ${formatLargeNumber(stock.averageVolume ?? 0)}`,
    "",

    // ── Fundamentals ─────────────────────────────────────────────────────────
    `📊  FUNDAMENTALS`,
    SEP,
    `  Market Cap      : ${formatLargeNumber(stock.marketCap ?? 0, stock.currency)}`,
    `  P/E Ratio       : ${stock.trailingPE?.toFixed(2) ?? "N/A"}  (Forward: ${stock.forwardPE?.toFixed(2) ?? "N/A"})`,
    `  EPS (TTM)       : ${stock.trailingEps ? formatCurrency(stock.trailingEps, stock.currency) : "N/A"}`,
    `  Revenue (TTM)   : ${formatLargeNumber(stock.totalRevenue ?? 0, stock.currency)}`,
    `  Profit Margin   : ${stock.profitMargins ? formatPct(stock.profitMargins * 100) : "N/A"}`,
    `  Revenue Growth  : ${stock.revenueGrowth ? formatPct(stock.revenueGrowth * 100) : "N/A"}`,
    `  Debt / Equity   : ${stock.debtToEquity?.toFixed(2) ?? "N/A"}`,
    `  Return on Equity: ${stock.returnOnEquity ? formatPct(stock.returnOnEquity * 100) : "N/A"}`,
    `  Free Cash Flow  : ${stock.freeCashflow ? formatLargeNumber(stock.freeCashflow, stock.currency) : "N/A"}`,
    "",

    // ── Dividend info (if applicable) ─────────────────────────────────────────
    ...(stock.dividendYield
      ? [
          `💰  DIVIDEND`,
          SEP,
          `  Yield           : ${formatPct(stock.dividendYield * 100)}`,
          `  Annual Rate     : ${stock.dividendRate ? formatCurrency(stock.dividendRate, stock.currency) : "N/A"}`,
          `  Ex-Dividend     : ${stock.exDividendDate ? new Date(stock.exDividendDate * 1000).toLocaleDateString() : "N/A"}`,
          `  Payout Ratio    : ${stock.payoutRatio ? formatPct(stock.payoutRatio * 100) : "N/A"}`,
          "",
        ]
      : []),

    // ── Analyst consensus ─────────────────────────────────────────────────────
    ...(stock.targetMeanPrice || stock.recommendationKey
      ? [
          `🎯  ANALYST CONSENSUS`,
          SEP,
          `  Recommendation  : ${(stock.recommendationKey ?? "N/A").toUpperCase()}`,
          ...(stock.targetMeanPrice
            ? [
                `  Price Target    : ${formatCurrency(stock.targetMeanPrice, stock.currency)}  (Low: ${formatCurrency(stock.targetLowPrice ?? 0, stock.currency)}  High: ${formatCurrency(stock.targetHighPrice ?? 0, stock.currency)})`,
                `  Upside Potential: ${stock.price && stock.targetMeanPrice ? formatPct(((stock.targetMeanPrice - stock.price) / stock.price) * 100) : "N/A"}`,
              ]
            : []),
          ...(stock.numberOfAnalystOpinions
            ? [`  Analyst Coverage: ${stock.numberOfAnalystOpinions} analysts`]
            : []),
          "",
        ]
      : []),

    // ── Risk / volatility ─────────────────────────────────────────────────────
    ...(stock.beta !== undefined
      ? [
          `⚡  RISK & VOLATILITY`,
          SEP,
          `  Beta            : ${stock.beta?.toFixed(2) ?? "N/A"}  ${stock.beta > 1.5 ? "(High volatility)" : stock.beta < 0.5 ? "(Low volatility)" : "(Market-like)"}`,
          `  Short % Float   : ${stock.shortPercentOfFloat ? formatPct(stock.shortPercentOfFloat * 100) : "N/A"}`,
          "",
        ]
      : []),

    // ── AI Analysis ───────────────────────────────────────────────────────────
    `🤖  AI ANALYSIS`,
    SEP,
    ...analysis.text.split("\n").map((l) => `  ${l}`),
    "",
    WIDE,
    `  Data: Yahoo Finance  •  ${new Date().toLocaleString()}`,
    WIDE,
    "",
  ];

  const reportText = lines.join("\n");

  // Stream the report
  emit(reportText);

  // Optional PDF generation
  if (wantPdf) {
    const ask = _askHandler ?? defaultAskHandler;
    const guard = await guardOperation(
      {
        category: "finance",
        description: "Report Stock as PDF",
        detail: "Financial report",
      },
      ask,
    );

    if (!guard.allowed) {
      return text(`🚫 ${guard.reason ?? "Permission denied."}`);
    }

    emit(`\n📄 Generating PDF report…\n`);
    try {
      const pdfPath = await generateReport(stock, analysis.text);
      emit(`✅ PDF saved: ${pdfPath}\n`);
      return text(reportText + `\n📄 PDF saved: ${pdfPath}`);
    } catch (err: any) {
      emit(`⚠️  PDF generation failed: ${err.message}\n`);
    }
  }

  return text(reportText);
}
