// src/modules/finance/analyze.ts
//
// AI-powered stock analysis — uses the enhanced data for deeper insights.
//
// FIX: Removed two truncation sources:
//   1. longBusinessSummary.slice(0, 400) → now uses full summary (up to 2000 chars)
//   2. maxTokens: 800 → raised to 2048 so the analysis is never cut mid-sentence

import type { AIProvider } from "../../providers/types.js";
import type { StockData } from "./types.js";
import type { EnhancedStockData } from "./enhanced.js";
import { formatCurrency, formatLargeNumber, formatPct } from "./format.js";

const SYSTEM_PROMPT = `You are a senior equity research analyst at a top-tier investment bank.
Analyze the provided stock data and produce a concise, insightful investment brief.

Structure your response in these exact sections (use the headers as shown):
**Investment Thesis**
2-3 sentences on the core bull/bear case.

**Strengths**
3-4 bullet points (start each with •)

**Risks & Concerns**
2-3 bullet points (start each with •)

**Valuation**
1-2 sentences comparing current valuation to peers/history.

**Verdict**
One clear sentence: Buy / Hold / Sell and a brief reason. Include a 12-month price target range if data permits.

Be direct, data-driven, and avoid generic statements. Write as if for a sophisticated investor.`;

export async function analyzeStock(
  provider: AIProvider,
  stock: EnhancedStockData | StockData,
  model?: string,
) {
  // Build a compact data summary for the LLM
  const enhanced = stock as EnhancedStockData;
  const basic = stock as StockData;

  // FIX: was .slice(0, 400) — now allows up to 2000 chars so the business
  // context is not arbitrarily cut off mid-sentence.
  const businessSummary = (
    enhanced.longBusinessSummary ??
    basic.summary ??
    ""
  ).slice(0, 2000);

  const dataBlock = [
    `Company: ${enhanced.longName ?? basic.shortName ?? enhanced.symbol ?? basic.symbol}`,
    `Ticker: ${enhanced.symbol ?? basic.symbol}`,
    `Sector: ${enhanced.sector ?? basic.sector ?? "N/A"}  |  Industry: ${enhanced.industry ?? basic.industry ?? "N/A"}`,
    ``,
    `--- PRICE & VALUATION ---`,
    `Price: ${formatCurrency(enhanced.price ?? basic.price ?? 0, enhanced.currency)}`,
    `52W Range: ${formatCurrency(enhanced.fiftyTwoWeekLow ?? 0, enhanced.currency)} – ${formatCurrency(enhanced.fiftyTwoWeekHigh ?? 0, enhanced.currency)}`,
    `Market Cap: ${formatLargeNumber(enhanced.marketCap ?? basic.marketCap ?? 0, enhanced.currency)}`,
    `P/E (TTM): ${enhanced.trailingPE?.toFixed(1) ?? basic.peRatio?.toFixed(1) ?? "N/A"}`,
    `P/E (Fwd): ${enhanced.forwardPE?.toFixed(1) ?? "N/A"}`,
    `P/S: ${enhanced.priceToSalesTrailing12Months?.toFixed(2) ?? "N/A"}`,
    `P/B: ${enhanced.priceToBook?.toFixed(2) ?? "N/A"}`,
    `EV/EBITDA: ${enhanced.enterpriseToEbitda?.toFixed(1) ?? "N/A"}`,
    `Beta: ${enhanced.beta?.toFixed(2) ?? "N/A"}`,
    ``,
    `--- FINANCIALS ---`,
    `Revenue (TTM): ${formatLargeNumber(enhanced.totalRevenue ?? 0, enhanced.currency)}`,
    `Revenue Growth: ${enhanced.revenueGrowth ? formatPct(enhanced.revenueGrowth * 100) : "N/A"}`,
    `Gross Margin: ${enhanced.grossMargins ? formatPct(enhanced.grossMargins * 100) : "N/A"}`,
    `Operating Margin: ${enhanced.operatingMargins ? formatPct(enhanced.operatingMargins * 100) : "N/A"}`,
    `Net Margin: ${enhanced.profitMargins ? formatPct(enhanced.profitMargins * 100) : "N/A"}`,
    `EBITDA: ${formatLargeNumber(enhanced.ebitda ?? 0, enhanced.currency)}`,
    `Free Cash Flow: ${formatLargeNumber(enhanced.freeCashflow ?? 0, enhanced.currency)}`,
    `Return on Equity: ${enhanced.returnOnEquity ? formatPct(enhanced.returnOnEquity * 100) : "N/A"}`,
    `Debt/Equity: ${enhanced.debtToEquity?.toFixed(2) ?? basic.debtPerEquity?.toFixed(2) ?? "N/A"}`,
    ``,
    `--- ANALYST CONSENSUS ---`,
    `Rating: ${enhanced.recommendationKey?.toUpperCase() ?? "N/A"}`,
    `Target Price: ${enhanced.targetMeanPrice ? formatCurrency(enhanced.targetMeanPrice, enhanced.currency) : "N/A"}`,
    `Analysts: ${enhanced.numberOfAnalystOpinions ?? "N/A"}`,
    `Short % Float: ${enhanced.shortPercentOfFloat ? formatPct(enhanced.shortPercentOfFloat * 100) : "N/A"}`,
    ``,
    `--- DIVIDENDS ---`,
    `Yield: ${enhanced.dividendYield ? formatPct(enhanced.dividendYield * 100) : "None"}`,
    `Payout Ratio: ${enhanced.payoutRatio ? formatPct(enhanced.payoutRatio * 100) : "N/A"}`,
    ``,
    `Business Summary:`,
    businessSummary,
  ].join("\n");

  // FIX: was maxTokens: 800 — too low for a full 5-section analysis.
  // Raised to 2048 so the Verdict section is never truncated mid-sentence.
  const response = await provider.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: dataBlock },
    ],
    { model, maxTokens: 2048 },
  );

  return response;
}
