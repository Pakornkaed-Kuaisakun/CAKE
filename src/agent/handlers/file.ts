import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  readFile,
  listDirectory,
  createDirectoryTree,
  summarizeFile,
  composeFile,
} from "../../modules/files/index.js";
import { text } from "../utils/text.js";

export async function handleFileList(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const match = input.match(/(?:ls|list)\s+(?:files?\s+in|directory)?\s*(.+)/i);
  const dir = match?.[1]?.trim() ?? ".";
  const files = listDirectory(dir);
  return text(`[FILES] ${dir}:\n${files.map((f) => `  ${f}`).join("\n")}`);
}

export async function handleDirectoryTree(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const match = input.match(/^(?:ls\s+)?tree(?:\s+(.+))?$/i);
  const dir = match?.[1]?.trim() || ".";
  try {
    const tree = createDirectoryTree(dir, { showSize: true, maxDepth: 5 });
    return text(`[FILES] ${dir}\n\n${tree}`);
  } catch (err: any) {
    return text(`Failed to read directory "${dir}"\n${err.message}`);
  }
}

export async function handleFileRead(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const match = input.match(/(?:read|show|open|cat)\s+(?:file\s+)?(.+)/i);
  const filePath = match?.[1]?.trim();
  if (!filePath) return text("Please specify a file path.");
  const content = await readFile(filePath);
  return text(
    `[FILES] ${filePath}\n${"─".repeat(40)}\n${content.slice(0, 3000)}`,
  );

}

export async function handleFileSummarize(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const match = input.match(/(?:summarize)\s+(?:file\s+)?(.+)/i);
  const filePath = match?.[1]?.trim();
  if (!filePath) return text("Please specify a file path.");
  const summary = await summarizeFile(provider, filePath, model);
  return text(`[FILES] Summary of ${filePath}\n\n${summary}`);
}

export async function handleFileCompose(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const match = input.match(
    /(?:compose|create|write)\s+file\s+(.+?)\s+(?:with|about|containing)\s+(.+)/i,
  );
  if (!match) return text("Usage: compose file <path> with <description>");
  const content = await composeFile(
    provider,
    match[1].trim(),
    match[2].trim(),
    model,
  );
  return text(
    `[FILES] Created ${match[1]}\n${"─".repeat(40)}\n${content.slice(0, 1000)}`,
  );
}
