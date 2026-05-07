import YahooFinance from "yahoo-finance2";

import type { StockData } from "./types.js";

export async function fetchStockData(symbol: string): Promise<StockData> {
  const yahooFinance = new YahooFinance();

  const quote: any = await yahooFinance.quote(symbol);

  const summary: any = await yahooFinance.quoteSummary(symbol, {
    modules: ["assetProfile", "financialData"],
  });

  return {
    symbol,

    shortName: quote.shortName ?? "unknown",

    price: quote.regularMarketPrice ?? 0,

    marketCap: quote.marketCap ?? 0,

    peRatio: quote.trailingPE ?? 0,

    eps: summary.financialData.trailingEps ?? 0,

    debtPerEquity: summary.financialData.debtToEquity ?? 0,

    sector: summary.assetProfile.sector ?? "unknown",

    industry: summary.assetProfile.industry ?? "unknown",

    summary: summary.assetProfile.longBusinessSummary ?? "unknown",
  };
}

// fetchStockData("aapl").then(console.log);
