import path from "path";
import type { AIProvider } from "../../providers/types.js";
import { readFile, writeFile } from "./operations.js";

export async function summarizeFile(
  provider: AIProvider,
  filePath: string,
  model?: string,
): Promise<string> {
  const content = await readFile(filePath);
  const ext = path.extname(filePath);

  const prompt = `Summarize the content of this ${ext || "text"} file in a few sentences:\n\n${content.slice(0, 4000)}`;
  const result = await provider.chat([{ role: "user", content: prompt }], { model });
  return result.text;
}

export async function editFileWithAI(
  provider: AIProvider,
  filePath: string,
  instruction: string,
  model?: string,
): Promise<string> {
  const content = await readFile(filePath);
  const prompt = `Here is the file content:\n\`\`\`\n${content}\n\`\`\`\n\nInstruction: ${instruction}\n\nReturn ONLY the modified file content with no extra explanation.`;

  const result = await provider.chat([{ role: "user", content: prompt }], { model });
  writeFile(filePath, result.text);
  return result.text;
}

export async function composeFile(
  provider: AIProvider,
  filePath: string,
  description: string,
  model?: string,
): Promise<string> {
  const ext = path.extname(filePath);
  const prompt = `Create a ${ext || "text"} file with the following content: ${description}\n\nReturn ONLY the file content with no extra explanation.`;
  const result = await provider.chat([{ role: "user", content: prompt }], { model });
  writeFile(filePath, result.text);
  return result.text;
}
