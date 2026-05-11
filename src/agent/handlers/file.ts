import path from "path";
import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  readFile,
  listDirectory,
  createDirectoryTree,
  summarizeFile,
  composeFile,
  findFiles,
} from "../../modules/files/index.js";
import { text } from "../utils/text.js";
import { formatSize } from "../utils/format.js";


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

export async function handleFindFile(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const match = input.match(
    /(?:find|search)\s+(?:file\s+)?(.+?)(?:\s+in\s+(.+))?$/i,
  );
  const query = match?.[1]?.trim();
  const root = match?.[2]?.trim();

  if (!query) return text("Please specify a filename or query to find.");

  const results = await findFiles(query, { root });

  if (results.length === 0) {
    const context = root ? ` in "${root}"` : "";
    return text(`[FILES] No files found matching "${query}"${context}`);
  }

  const list = results
    .map((f, i) => {
      const score = (f.similarity * 100).toFixed(1);
      return `${i + 1}. ${f.name}\n   Path: ${f.path}\n   Size: ${formatSize(f.size)}\n   Similarity: ${score}%`;
    })
    .join("\n\n");

  const count = results.length;
  const unit = count === 1 ? "FILE" : "FILES";
  return text(`[FOUND ${count} ${unit}]\n\n${list}`);
}
