// src/agent/handlers/file.ts
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
import { formatSize, formatChatResult } from "../../shared/utils/utils.js";
import {
  guardOperation,
  type PermissionRequest,
  type PermissionDecision,
} from "../permissions/index.js";

// ── Shared ask handler (set by CLI, same pattern as bash) ─────────────────────

let _askHandler:
  | ((req: PermissionRequest) => Promise<PermissionDecision>)
  | null = null;

export function setFileAskHandler(
  fn: (req: PermissionRequest) => Promise<PermissionDecision>,
): void {
  _askHandler = fn;
}

async function defaultAskHandler(
  req: PermissionRequest,
): Promise<PermissionDecision> {
  if (!process.stdin.isTTY) return "deny";
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `\n⚠️  Permission required\n` +
        `   Operation : ${req.description}\n` +
        `   Detail    : ${req.detail}\n` +
        `   Allow? [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "y" ? "allow" : "deny");
      },
    );
  });
}

// ── Read-only handlers (no permission needed) ─────────────────────────────────

export async function handleFileList(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const match = input.match(/(?:ls|list)\s+(?:files?\s+in|directory)?\s*(.+)/i);
  const dir = match?.[1]?.trim() ?? ".";
  const files = listDirectory(dir);
  return formatChatResult(
    `[FILES] ${dir}:\n${files.map((f) => `  ${f}`).join("\n")}`,
  );
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
    return formatChatResult(`[FILES] ${dir}\n\n${tree}`);
  } catch (err: any) {
    return formatChatResult(
      `Failed to read directory "${dir}"\n${err.message}`,
    );
  }
}

export async function handleFileRead(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const match = input.match(/(?:read|show|open|cat)\s+(?:file\s+)?(.+)/i);
  const filePath = match?.[1]?.trim();
  if (!filePath) return formatChatResult("Please specify a file path.");
  const content = await readFile(filePath);
  return formatChatResult(
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
  if (!filePath) return formatChatResult("Please specify a file path.");
  const summary = await summarizeFile(provider, filePath, model);
  return formatChatResult(`[FILES] Summary of ${filePath}\n\n${summary}`);
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

  if (!query)
    return formatChatResult("Please specify a filename or query to find.");

  const results = await findFiles(query, { root });

  if (results.length === 0) {
    const context = root ? ` in "${root}"` : "";
    return formatChatResult(
      `[FILES] No files found matching "${query}"${context}`,
    );
  }

  const list = results
    .map((f, i) => {
      const score = (f.similarity * 100).toFixed(1);
      return `${i + 1}. ${f.name}\n   Path: ${f.path}\n   Size: ${formatSize(f.size)}\n   Similarity: ${score}%`;
    })
    .join("\n\n");

  const count = results.length;
  const unit = count === 1 ? "FILE" : "FILES";
  return formatChatResult(`[FOUND ${count} ${unit}]\n\n${list}`);
}

// ── Write handlers (permission required) ──────────────────────────────────────

export async function handleFileCompose(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const match = input.match(
    /(?:compose|create|write)\s+file\s+(.+?)\s+(?:with|about|containing)\s+(.+)/i,
  );
  if (!match)
    return formatChatResult("Usage: compose file <path> with <description>");

  const filePath = match[1].trim();
  const description = match[2].trim();

  // ── Permission check ──────────────────────────────────────────────────────
  const ask = _askHandler ?? defaultAskHandler;
  const guard = await guardOperation(
    {
      category: "file_write",
      description: "Create a new file",
      detail: path.resolve(filePath),
    },
    ask,
  );

  if (!guard.allowed) {
    return formatChatResult(`🚫 ${guard.reason ?? "Permission denied."}`);
  }

  const content = await composeFile(provider, filePath, description, model);
  return formatChatResult(
    `[FILES] Created ${filePath}\n${"─".repeat(40)}\n${content.slice(0, 1000)}`,
  );
}
