import {
  fetchStockData,
  analyzeStock,
  generateReport,
} from "../../modules/finance/index.js";

import type { ChatResult, AIProvider } from "../../providers/types.js";

export async function handleFinanceReport(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  /**
   * Extract ticker
   */

  const tickerMatch = input.toUpperCase().match(/\b[A-Z]{1,5}\b/);

  const symbol = tickerMatch?.[0];

  if (!symbol) {
    return {
      text: "Please provide a valid stock ticker symbol.",
    };
  }

  try {
    /**
     * Fetch stock data
     */

    const stock = await fetchStockData(symbol);

    if (!stock) {
      return {
        text: `Could not fetch stock data for ${symbol}`,
      };
    }

    /**
     * AI analysis
     */

    const analysis = await analyzeStock(provider, stock, model);

    /**
     * Generate PDF
     */

    const reportPath = await generateReport(stock, analysis.text);

    return {
      text:
        `📄 Financial report created successfully\n\n` +
        `Ticker: ${symbol}\n` +
        `File: ${reportPath}`,
    };
  } catch (error: any) {
    return {
      text: `Failed to create financial report.\n\n${error.message}`,
    };
  }
}
