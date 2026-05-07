import { fromPath } from "pdf2pic";
import { extractTextFromImage } from "./ocr.js";

export async function readScannedPDF(filePath: string): Promise<string> {
  const convert = fromPath(filePath, {
    density: 150,
    saveFilename: "page",
    savePath: "./tmp",
    format: "png",
  });

  const pages = await convert.bulk(-1);

  let text = "";
  for (const page of pages) {
    const extracted = await extractTextFromImage(String(page.path));
    text += extracted + "\n";
  }

  return text;
}
