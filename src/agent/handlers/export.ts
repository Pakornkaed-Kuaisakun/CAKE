// src/agent/handlers/export.ts
import fs from "fs";
import path from "path";
import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  guardOperation,
  getPermissionLevel,
  type PermissionRequest,
  type PermissionDecision,
} from "../permissions/index.js";

type ExportFormat = "txt" | "md" | "json" | "csv" | "html";

const FORMAT_ALIASES: Record<string, ExportFormat> = {
  txt: "txt",
  text: "txt",
  md: "md",
  markdown: "md",
  json: "json",
  csv: "csv",
  html: "html",
  htm: "html",
};

const DEFAULT_EXPORT_DIR = "reports";

function resolveOutput(format: ExportFormat, argsAfterFormat: string): string {
  const raw = argsAfterFormat.trim().replace(/^["']|["']$/g, "");
  let target: string;
  if (!raw) {
    target = `output-${Date.now()}.${format}`;
  } else {
    const ext = path.extname(raw);
    target = ext ? raw : `${raw}.${format}`;
  }
  if (!path.isAbsolute(target)) {
    return path.resolve(DEFAULT_EXPORT_DIR, target);
  }
  return path.resolve(target);
}

function convertContent(content: string, format: ExportFormat): string {
  switch (format) {
    case "txt":
    case "md":
      return content;
    case "json": {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return JSON.stringify({ output: content }, null, 2);
      }
    }
    case "csv": {
      const lines = content.split("\n").filter((l) => l.trim());
      const csvRows = lines.map((line) => {
        const clean = line.replace(/^[\s•\-\*]+/, "").trim();
        const quoted = clean.includes(",")
          ? `"${clean.replace(/"/g, '""')}"`
          : clean;
        return quoted;
      });
      return csvRows.join("\n");
    }
    case "html": {
      const escaped = content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const withBreaks = escaped.replace(/\n/g, "<br>\n");
      return `<!DOCTYPE html>
<html lang="en">
    <head>
    <meta charset="UTF-8">
    <title>CAKE Export</title>
    <style>
        body { font-family: monospace; padding: 2rem; max-width: 900px; margin: 0 auto; }
        pre  { white-space: pre-wrap; word-break: break-word; }
    </style>
    </head>
    <body>
        <pre>${withBreaks}</pre>
    </body>
</html>`;
    }
    default:
      return content;
  }
}

// ── Shared ask handler ────────────────────────────────────────────────────────

let _askHandler:
  | ((req: PermissionRequest) => Promise<PermissionDecision>)
  | null = null;

export function setExportAskHandler(
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

// ── Core write (used by pipeline executor too) ────────────────────────────────

export async function exportSink(
  content: string,
  _command: string,
  rawArgs: string,
): Promise<ChatResult> {
  const parts = rawArgs.trim().split(/\s+/);
  const formatToken = parts[0]?.toLocaleLowerCase() ?? "txt";
  const format: ExportFormat = FORMAT_ALIASES[formatToken] ?? "txt";
  const pathArgs = parts.slice(1).join(" ");

  const outPath = resolveOutput(format, pathArgs);
  const converted = convertContent(content, format);

  // ── Permission check ────────────────────────────────────────────────────────
  // export defaults to "allow" in permissions, but respect whatever level is set
  const ask = _askHandler ?? defaultAskHandler;
  const guard = await guardOperation(
    {
      category: "export",
      description: "Write output to file",
      detail: outPath,
    },
    ask,
  );

  if (!guard.allowed) {
    return { text: `🚫 ${guard.reason ?? "Permission denied."}` };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, converted, "utf-8");

  const sizeKb = (Buffer.byteLength(converted, "utf-8") / 1024).toFixed(1);
  return {
    text: `✅ Exported to ${outPath}\n   Format: ${format.toUpperCase()} | Size: ${sizeKb} KB`,
  };
}

// ── Standalone handler ────────────────────────────────────────────────────────

export async function handleExport(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const withoutVerb = input.replace(/^export\s+/i, "").trim();

  // Pipeline marker
  const pipeMarker = "__pipe__:";
  const pipeIdx = withoutVerb.indexOf(pipeMarker);
  if (pipeIdx !== -1) {
    const rawArgs = withoutVerb.slice(0, pipeIdx).trim();
    const content = withoutVerb.slice(pipeIdx + pipeMarker.length).trim();
    return exportSink(content, "export", rawArgs);
  }

  // Inline content
  const inlineIdx = withoutVerb.indexOf("|");
  if (inlineIdx !== -1) {
    const rawArgs = withoutVerb.slice(0, inlineIdx).trim();
    const content = withoutVerb.slice(inlineIdx + 1);
    if (content.trim()) {
      return exportSink(content, "export", rawArgs);
    }
  }

  return {
    text: "Usage: export <format> [filename]|<content>\nFormats: txt, md, json, csv, html",
  };
}
