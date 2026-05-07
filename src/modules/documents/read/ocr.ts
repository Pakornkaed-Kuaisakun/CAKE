import Tesseract from "tesseract.js";

export async function extractTextFromImage(imgPath: string): Promise<string> {
  const result = await Tesseract.recognize(imgPath, "eng");
  return result.data.text;
}
