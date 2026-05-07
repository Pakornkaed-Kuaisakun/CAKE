import fs from "fs";
import path from "path";

import PDFDocument from "pdfkit";

import type { StockData } from "./types.js";

export async function generateReport(
  stock: StockData,
  analysis: string,
): Promise<string> {
  const outputDir = path.resolve("reports/financial");

  fs.mkdirSync(outputDir, {
    recursive: true,
  });

  const filePath = path.join(outputDir, `${stock.symbol}-${Date.now()}.pdf`);

  const doc = new PDFDocument();

  const stream = fs.createWriteStream(filePath);

  doc.pipe(stream);

  /**
   * TITLE
   */

  doc.fontSize(24).text(`${stock.symbol} Financial Report`);

  doc.moveDown();

  /**
   * COMPANY INFO
   */

  doc.fontSize(16).text(`Company: ${stock.shortName}`);

  doc.text(`Price: $${stock.price}`);

  doc.text(`Market Cap: ${stock.marketCap}`);

  doc.text(`P/E Ratio: ${stock.peRatio}`);

  doc.text(`EPS: ${stock.eps}`);

  doc.text(`Sector: ${stock.sector}`);

  doc.text(`Industry: ${stock.industry}`);

  doc.moveDown();

  /**
   * SUMMARY
   */

  doc.fontSize(18).text("Business Summary");

  doc.fontSize(12).text(stock.summary || "");

  doc.moveDown();

  /**
   * AI ANALYSIS
   */

  doc.fontSize(18).text("AI Analysis");

  doc.fontSize(12).text(analysis);

  doc.end();

  await new Promise<void>((resolve) => {
    stream.on("finish", () => resolve());
  });

  return filePath;
}
