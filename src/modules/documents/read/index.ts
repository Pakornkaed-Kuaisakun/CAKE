import path from "path";

import { readPDF } from "./pdf.js";
import { readDocx } from "./docx.js";
import { readTxt } from "./txt.js";
import { readScannedPDF } from "./scannedPDF.js";

import { isScannedPDF } from "../utils/detectScannedPDF.js";
import { cleanText } from "../utils/cleanText.js";

export async function readDocument(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  let text = "";

  switch (ext) {
    case ".pdf": {
      text = await readPDF(filePath);

      if (isScannedPDF(text)) {
        text = await readScannedPDF(filePath);
      }

      break;
    }

    case ".docx":
      text = await readDocx(filePath);
      break;

    case ".txt":
      text = readTxt(filePath);
      break;

    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }

  return cleanText(text);
}
