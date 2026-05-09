import {
  fetchStockData,
  analyzeStock,
  generateReport,
} from "../../modules/finance/index.js";
import type { ChatResult, AIProvider } from "../../providers/types.js";

// Common English words to exclude from ticker detection
const STOP_WORDS = new Set([
  "PLEASE",
  "VALID",
  "STOCK",
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
]);

function extractTicker(input: string): string | null {
  // Look for explicit ticker patterns: $AAPL, AAPL:, or isolated 1-5 uppercase letters
  const dollarMatch = input.match(/\$([A-Z]{1,5})\b/);
  if (dollarMatch) return dollarMatch[1];

  const colonMatch = input.match(/\b([A-Z]{1,5}):/);
  if (colonMatch) return colonMatch[1];

  // Fallback: find isolated uppercase word 1-5 chars, skip stop words
  const words = input.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? [];
  for (const word of words) {
    if (!STOP_WORDS.has(word)) return word;
  }

  return null;
}

export async function handleFinanceReport(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const symbol = extractTicker(input);

  if (!symbol) {
    return {
      text: "Please provide a valid stock ticker symbol, e.g. finance AAPL or finance $TSLA",
    };
  }

  try {
    const stock = await fetchStockData(symbol);

    if (!stock) {
      return { text: `Could not fetch stock data for ${symbol}` };
    }

    const analysis = await analyzeStock(provider, stock, model);
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
