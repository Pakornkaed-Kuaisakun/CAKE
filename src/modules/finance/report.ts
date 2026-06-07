// src/modules/finance/report.ts
//
// FIX: Accept EnhancedStockData | StockData so the PDF can use the full
// longBusinessSummary instead of the truncated StockData.summary field.

import fs from "fs";
import path from "path";

import PDFDocument from "pdfkit";

import type { StockData } from "./types.js";
import type { EnhancedStockData } from "./enhanced.js";
import {
  formatCurrency,
  formatLargeNumber,
  formatPct,
} from "../../shared/utils/utils.js";

export async function generateReport(
  stock: EnhancedStockData | StockData,
  analysis: string,
): Promise<string> {
  const outputDir = path.resolve("reports/financial");

  fs.mkdirSync(outputDir, {
    recursive: true,
  });

  const symbol =
    (stock as EnhancedStockData).symbol ?? (stock as StockData).symbol;
  const filePath = path.join(outputDir, `${symbol}-${Date.now()}.pdf`);

  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // ── TITLE ──────────────────────────────────────────────────────────────────
  const enhanced = stock as EnhancedStockData;
  const basic = stock as StockData;
  const companyName =
    enhanced.longName ?? enhanced.shortName ?? basic.shortName ?? symbol;
  const price = enhanced.price ?? basic.price ?? 0;
  const currency = enhanced.currency ?? "USD";

  doc.fontSize(24).font("Helvetica-Bold").text(`${symbol} Financial Report`);
  doc.fontSize(14).font("Helvetica").text(companyName);
  doc.moveDown(0.5);

  // ── PRICE & KEY METRICS ───────────────────────────────────────────────────
  doc.fontSize(16).font("Helvetica-Bold").text("Key Metrics");
  doc.fontSize(11).font("Helvetica");

  const metrics: [string, string][] = [
    ["Price", formatCurrency(price, currency)],
    [
      "Market Cap",
      formatLargeNumber(enhanced.marketCap ?? basic.marketCap ?? 0, currency),
    ],
    [
      "P/E Ratio (TTM)",
      enhanced.trailingPE?.toFixed(2) ?? basic.peRatio?.toFixed(2) ?? "N/A",
    ],
    ["P/E Ratio (Fwd)", enhanced.forwardPE?.toFixed(2) ?? "N/A"],
    [
      "EPS (TTM)",
      enhanced.trailingEps
        ? formatCurrency(enhanced.trailingEps, currency)
        : basic.eps
          ? formatCurrency(basic.eps)
          : "N/A",
    ],
    ["Revenue (TTM)", formatLargeNumber(enhanced.totalRevenue ?? 0, currency)],
    [
      "Revenue Growth",
      enhanced.revenueGrowth ? formatPct(enhanced.revenueGrowth * 100) : "N/A",
    ],
    [
      "Gross Margin",
      enhanced.grossMargins ? formatPct(enhanced.grossMargins * 100) : "N/A",
    ],
    [
      "Net Margin",
      enhanced.profitMargins ? formatPct(enhanced.profitMargins * 100) : "N/A",
    ],
    [
      "Free Cash Flow",
      enhanced.freeCashflow
        ? formatLargeNumber(enhanced.freeCashflow, currency)
        : "N/A",
    ],
    [
      "Return on Equity",
      enhanced.returnOnEquity
        ? formatPct(enhanced.returnOnEquity * 100)
        : "N/A",
    ],
    [
      "Debt/Equity",
      enhanced.debtToEquity?.toFixed(2) ??
        basic.debtPerEquity?.toFixed(2) ??
        "N/A",
    ],
    ["Beta", enhanced.beta?.toFixed(2) ?? "N/A"],
    [
      "Dividend Yield",
      enhanced.dividendYield ? formatPct(enhanced.dividendYield * 100) : "None",
    ],
    ["Sector", enhanced.sector ?? basic.sector ?? "N/A"],
    ["Industry", enhanced.industry ?? basic.industry ?? "N/A"],
  ];

  for (const [label, value] of metrics) {
    doc.text(`${label}: ${value}`);
  }

  // ── ANALYST CONSENSUS ─────────────────────────────────────────────────────
  if (enhanced.recommendationKey || enhanced.targetMeanPrice) {
    doc.moveDown(0.5);
    doc.fontSize(16).font("Helvetica-Bold").text("Analyst Consensus");
    doc.fontSize(11).font("Helvetica");

    if (enhanced.recommendationKey) {
      doc.text(`Rating: ${enhanced.recommendationKey.toUpperCase()}`);
    }
    if (enhanced.targetMeanPrice) {
      doc.text(
        `Price Target: ${formatCurrency(enhanced.targetMeanPrice, currency)}`,
      );
      doc.text(
        `Target Range: ${formatCurrency(enhanced.targetLowPrice ?? 0, currency)} – ${formatCurrency(enhanced.targetHighPrice ?? 0, currency)}`,
      );
    }
    if (enhanced.numberOfAnalystOpinions) {
      doc.text(`Coverage: ${enhanced.numberOfAnalystOpinions} analysts`);
    }
  }

  doc.moveDown();

  // ── BUSINESS SUMMARY ──────────────────────────────────────────────────────
  // FIX: was `stock.summary ?? ""` which only had ~400 chars from StockData.
  // Now uses the full longBusinessSummary from EnhancedStockData (no slice).
  const businessSummary = enhanced.longBusinessSummary ?? basic.summary ?? "";

  if (businessSummary) {
    doc.fontSize(16).font("Helvetica-Bold").text("Business Summary");
    doc
      .fontSize(11)
      .font("Helvetica")
      .text(businessSummary, { align: "justify" });
    doc.moveDown();
  }

  // ── AI ANALYSIS ───────────────────────────────────────────────────────────
  doc.fontSize(16).font("Helvetica-Bold").text("AI Analysis");
  doc.fontSize(11).font("Helvetica").text(analysis, { align: "justify" });

  doc.moveDown();
  doc
    .fontSize(9)
    .fillColor("gray")
    .text(`Generated: ${new Date().toLocaleString()} | Data: Yahoo Finance`);

  doc.end();

  await new Promise<void>((resolve) => {
    stream.on("finish", () => resolve());
  });

  return filePath;
}
