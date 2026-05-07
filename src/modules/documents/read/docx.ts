import * as mammoth from "mammoth";

/**
 * Reads a .docx file and returns its raw text content.
 */
export async function readDocx(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value; // The raw text
}
