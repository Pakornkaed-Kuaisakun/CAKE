import type { AIProvider } from "../../providers/types.js";

import type { StockData } from "./types.js";

export async function analyzeStock(
  provider: AIProvider,
  stock: StockData,
  model?: string,
) {
  return provider.chat(
    [
      {
        role: "system",

        content: `
        You are a professional financial analyst.

        Analyze the company using the provided stock data.

        Include:
        - company overview
        - valuation
        - growth potential
        - risks
        - conclusion
        `,
      },

      {
        role: "user",

        content: JSON.stringify(stock, null, 2),
      },
    ],
    { model },
  );
}
