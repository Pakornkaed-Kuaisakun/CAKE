export interface StockData {
  symbol: string;

  shortName?: string;

  price?: number;

  marketCap?: number;

  peRatio?: number;

  eps?: number;

  debtPerEquity?: number;

  sector?: string;

  industry?: string;

  summary?: string;
}
