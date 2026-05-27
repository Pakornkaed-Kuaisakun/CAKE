// src/modules/finance/enhanced.ts
//
// fetchEnhancedStockData — fetches a much richer set of fields from Yahoo Finance.
// Returns a flat object that the handler can render without further processing.

import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export interface EnhancedStockData {
  // Identity
  symbol: string;
  shortName?: string;
  longName?: string;
  exchange?: string;
  currency?: string;
  sector?: string;
  industry?: string;

  // Price
  price?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  averageVolume?: number;
  averageVolume10days?: number;

  // 52-week
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHighChange?: number;
  fiftyTwoWeekLowChange?: number;

  // Moving averages
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;

  // Valuation
  marketCap?: number;
  enterpriseValue?: number;
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  priceToSalesTrailing12Months?: number;
  enterpriseToRevenue?: number;
  enterpriseToEbitda?: number;

  // Earnings
  trailingEps?: number;
  forwardEps?: number;
  earningsGrowth?: number;

  // Revenue & margins
  totalRevenue?: number;
  revenueGrowth?: number;
  revenuePerShare?: number;
  grossMargins?: number;
  operatingMargins?: number;
  profitMargins?: number;
  ebitda?: number;
  ebitdaMargins?: number;

  // Balance sheet
  totalCash?: number;
  totalCashPerShare?: number;
  totalDebt?: number;
  debtToEquity?: number;
  currentRatio?: number;
  quickRatio?: number;
  bookValue?: number;

  // Cash flow
  freeCashflow?: number;
  operatingCashflow?: number;
  returnOnAssets?: number;
  returnOnEquity?: number;

  // Dividends
  dividendYield?: number;
  dividendRate?: number;
  exDividendDate?: number;
  payoutRatio?: number;
  trailingAnnualDividendYield?: number;

  // Analyst
  recommendationKey?: string;
  recommendationMean?: number;
  targetMeanPrice?: number;
  targetLowPrice?: number;
  targetHighPrice?: number;
  targetMedianPrice?: number;
  numberOfAnalystOpinions?: number;

  // Risk
  beta?: number;
  shortPercentOfFloat?: number;
  shortRatio?: number;
  sharesShort?: number;

  // Company info
  longBusinessSummary?: string;
  fullTimeEmployees?: number;
  website?: string;
}

export async function fetchEnhancedStockData(
  symbol: string,
): Promise<EnhancedStockData> {
  const upperSymbol = symbol.toUpperCase();

  const [quote, summary] = await Promise.all([
    yahooFinance.quote(upperSymbol) as Promise<any>,
    yahooFinance
      .quoteSummary(upperSymbol, {
        modules: [
          "assetProfile",
          "financialData",
          "defaultKeyStatistics",
          "summaryDetail",
          "price",
        ],
      })
      .catch(() => null) as Promise<any>,
  ]);

  const fd = summary?.financialData ?? {};
  const ks = summary?.defaultKeyStatistics ?? {};
  const sd = summary?.summaryDetail ?? {};
  const ap = summary?.assetProfile ?? {};
  const pr = summary?.price ?? {};

  return {
    symbol: upperSymbol,
    shortName: quote.shortName ?? pr.shortName,
    longName: quote.longName ?? pr.longName,
    exchange: quote.exchange ?? pr.exchangeName,
    currency: quote.currency ?? pr.currency ?? "USD",
    sector: ap.sector,
    industry: ap.industry,

    price: quote.regularMarketPrice ?? pr.regularMarketPrice?.raw,
    regularMarketChange:
      quote.regularMarketChange ?? pr.regularMarketChange?.raw,
    regularMarketChangePercent:
      quote.regularMarketChangePercent ?? pr.regularMarketChangePercent?.raw,
    regularMarketOpen: quote.regularMarketOpen,
    regularMarketDayHigh: quote.regularMarketDayHigh,
    regularMarketDayLow: quote.regularMarketDayLow,
    regularMarketVolume: quote.regularMarketVolume,
    averageVolume: quote.averageDailyVolume3Month ?? sd.averageVolume?.raw,
    averageVolume10days: quote.averageDailyVolume10Day,

    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? sd.fiftyTwoWeekHigh?.raw,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? sd.fiftyTwoWeekLow?.raw,
    fiftyTwoWeekHighChange: quote.fiftyTwoWeekHighChange,
    fiftyTwoWeekLowChange: quote.fiftyTwoWeekLowChange,

    fiftyDayAverage: quote.fiftyDayAverage ?? sd.fiftyDayAverage?.raw,
    twoHundredDayAverage:
      quote.twoHundredDayAverage ?? sd.twoHundredDayAverage?.raw,

    marketCap: quote.marketCap ?? pr.marketCap?.raw,
    enterpriseValue: ks.enterpriseValue?.raw,
    trailingPE: quote.trailingPE ?? sd.trailingPE?.raw,
    forwardPE: quote.forwardPE ?? sd.forwardPE?.raw,
    priceToBook: ks.priceToBook?.raw,
    priceToSalesTrailing12Months: quote.priceToSalesTrailing12Months,
    enterpriseToRevenue: ks.enterpriseToRevenue?.raw,
    enterpriseToEbitda: ks.enterpriseToEbitda?.raw,

    trailingEps: quote.epsTrailingTwelveMonths ?? ks.trailingEps?.raw,
    forwardEps: quote.epsForward ?? ks.forwardEps?.raw,
    earningsGrowth: fd.earningsGrowth?.raw,

    totalRevenue: fd.totalRevenue?.raw,
    revenueGrowth: fd.revenueGrowth?.raw,
    revenuePerShare: fd.revenuePerShare?.raw,
    grossMargins: fd.grossMargins?.raw,
    operatingMargins: fd.operatingMargins?.raw,
    profitMargins: fd.profitMargins?.raw,
    ebitda: fd.ebitda?.raw,
    ebitdaMargins: fd.ebitdaMargins?.raw,

    totalCash: fd.totalCash?.raw,
    totalCashPerShare: fd.totalCashPerShare?.raw,
    totalDebt: fd.totalDebt?.raw,
    debtToEquity: fd.debtToEquity?.raw,
    currentRatio: fd.currentRatio?.raw,
    quickRatio: fd.quickRatio?.raw,
    bookValue: ks.bookValue?.raw,

    freeCashflow: fd.freeCashflow?.raw,
    operatingCashflow: fd.operatingCashflow?.raw,
    returnOnAssets: fd.returnOnAssets?.raw,
    returnOnEquity: fd.returnOnEquity?.raw,

    dividendYield: sd.dividendYield?.raw ?? quote.dividendYield,
    dividendRate: sd.dividendRate?.raw ?? quote.trailingAnnualDividendRate,
    exDividendDate: sd.exDividendDate?.raw,
    payoutRatio: sd.payoutRatio?.raw,
    trailingAnnualDividendYield: sd.trailingAnnualDividendYield?.raw,

    recommendationKey: fd.recommendationKey ?? quote.averageAnalystRating,
    recommendationMean: fd.recommendationMean?.raw,
    targetMeanPrice: fd.targetMeanPrice?.raw,
    targetLowPrice: fd.targetLowPrice?.raw,
    targetHighPrice: fd.targetHighPrice?.raw,
    targetMedianPrice: fd.targetMedianPrice?.raw,
    numberOfAnalystOpinions: fd.numberOfAnalystOpinions?.raw,

    beta: quote.beta ?? ks.beta?.raw ?? sd.beta?.raw,
    shortPercentOfFloat: ks.shortPercentOfFloat?.raw,
    shortRatio: ks.shortRatio?.raw,
    sharesShort: ks.sharesShort?.raw,

    longBusinessSummary: ap.longBusinessSummary,
    fullTimeEmployees: ap.fullTimeEmployees,
    website: ap.website,
  };
}
