import fs from "fs";
import path from "path";
import type { AIProvider, ChatResult } from "../../providers/types.js";

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

/**
 * Resolve the output path from the args string.
 * Supports:
 *   "txt"               → auto-named  ./output-<timestamp>.txt
 *   "txt output.txt"    → ./output.txt
 *   "md reports/out"    → ./reports/out.md  (adds extension if missing)
 */

function resolveOutput(format: ExportFormat, argsAfterFormat: string): string {
  const raw = argsAfterFormat.trim().replace(/^["']|["']$/g, "");

  if (!raw) {
    return path.resolve(`output-${Date.now()}.${format}`);
  }

  const ext = path.extname(raw);
  if (ext) return path.resolve(raw);
  return path.resolve(`${raw}.${format}`);
}

/**
 * Convert plain text to the desired export format.
 */

function convertContent(content: string, format: ExportFormat): string {
  switch (format) {
    case "txt":
    case "md":
      return content;

    case "json": {
      // If already valid JSON, pretty-print it; otherwise wrap in an object
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return JSON.stringify({ output: content }, null, 2);
      }
    }

    case "csv": {
      // Best-effort: split lines into CSV rows
      const lines = content.split("\n").filter((l) => l.trim());
      const csvRows = lines.map((line) => {
        // If it looks like a bullet point, strip the leading marker
        const clean = line.replace(/^[\s•\-\*]+/, "").trim();
        // Quote fields that contain commas or qoutes
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

/**
 * Sink handler invoked by the pipeline executor.
 *
 * @param content   Accumulated text from the previous pipeline step(s)
 * @param _command  The sink command ("export" | "save" | "write") — currently unused
 * @param rawArgs   Everything after the sink keyword, e.g. "txt output.txt"
 */

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

  // Ensure parent directories exist
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, converted, "utf-8");

  const sizeKb = (Buffer.byteLength(converted, "utf-8") / 1024).toFixed(1);

  return {
    text: `✅ Exported to ${outPath}\n   Format: ${format.toUpperCase()} | Size: ${sizeKb} KB`,
  };
}

/**
 * Standalone handler for the router (so "export …" also works without a pipe).
 *
 * Supported input formats:
 *   1. Pipeline: "export md report.md__pipe__:<content>"  — from the | pipeline executor
 *   2. Inline:   "export md report.md|<content>"          — used by the autonomous agent
 *   3. No content: returns usage message
 */
export async function handleExport(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  // Strip the "export" verb, keep the rest
  const withoutVerb = input.replace(/^export\s+/i, "").trim();

  // ── 1) Pipeline marker (__pipe__:) ─────────────────────────────────────────
  const pipeMarker = "__pipe__:";
  const pipeIdx = withoutVerb.indexOf(pipeMarker);
  if (pipeIdx !== -1) {
    const rawArgs = withoutVerb.slice(0, pipeIdx).trim();
    const content = withoutVerb.slice(pipeIdx + pipeMarker.length).trim();
    return exportSink(content, "export", rawArgs);
  }

  // ── 2) Inline content via | separator (autonomous agent style) ─────────────
  // Format: "<format> <filename>|<content>"
  // e.g.  "md report.md|# Title\n\ncontent here"
  const inlineIdx = withoutVerb.indexOf("|");
  if (inlineIdx !== -1) {
    const rawArgs = withoutVerb.slice(0, inlineIdx).trim();  // "md report.md"
    const content = withoutVerb.slice(inlineIdx + 1);        // everything after |
    if (content.trim()) {
      return exportSink(content, "export", rawArgs);
    }
  }

  // ── 3) No content ──────────────────────────────────────────────────────────
  return {
    text: "Usage: export <format> [filename]|<content>\nFormats: txt, md, json, csv, html\nExamples:\n  directory_tree src | export txt tree.txt\n  export md report.md|# My Report\\n\\nContent here...",
  };
}
