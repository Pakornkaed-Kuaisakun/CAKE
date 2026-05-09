import fs from "fs";

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export async function readPDF(filePath: string): Promise<string> {
  try {
    const data = new Uint8Array(fs.readFileSync(filePath));

    const pdf = await pdfjsLib.getDocument({
      data,
      // Suppress worker warnings in Node environment
      useWorkerFetch: false,
      useSystemFonts: true,
      // isImageDecoderSupported: false,
    }).promise;

    let text = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);

      const content = await page.getTextContent();

      const strings = content.items.map((item: any) => item.str);

      text += strings.join(" ") + "\n";
    }

    return text;
  } catch (error: any) {
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}
