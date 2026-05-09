import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();
import type { StockData } from "./types.js";

export async function fetchStockData(symbol: string): Promise<StockData> {
  const [quote, summary] = await Promise.all([
    yahooFinance.quote(symbol) as Promise<any>,
    yahooFinance.quoteSummary(symbol, {
      modules: ["assetProfile", "financialData"],
    }) as Promise<any>,
  ]);

  return {
    symbol,
    shortName: quote.shortName ?? "unknown",
    price: quote.regularMarketPrice ?? 0,
    marketCap: quote.marketCap ?? 0,
    peRatio: quote.trailingPE ?? 0,
    eps: summary.financialData?.trailingEps ?? 0,
    debtPerEquity: summary.financialData?.debtToEquity ?? 0,
    sector: summary.assetProfile?.sector ?? "unknown",
    industry: summary.assetProfile?.industry ?? "unknown",
    summary: summary.assetProfile?.longBusinessSummary ?? "unknown",
  };
}
