// src/cli/components/MarkdownRenderer.tsx
//
// Streaming-safe Markdown renderer for Ink terminals.
//
// Key invariant: a line is only Markdown-parsed once it is "complete"
// (ended with \n in the stream). The in-progress partial line is always
// rendered as plain text so half-open tokens (* ` ** ~~) never break output.
//
// Supported (complete lines only):
//   # H1  ## H2  ### H3
//   **bold**  __bold__  *italic*  _italic_  ***bold italic***
//   `inline code`   ```fenced block```
//   > blockquote
//   - / * / + bullet list (nested)   1. numbered list
//   ---  ===  *** horizontal rule
//   [text](url)
//   ~~strikethrough~~

import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "../theme/types.js";

// ─── Inline types ─────────────────────────────────────────────────────────────

interface Span {
  type: "text" | "bold" | "italic" | "bolditalic" | "code" | "link" | "strike";
  content: string;
  href?: string;
}

// ─── Inline parser ────────────────────────────────────────────────────────────
// Only call this on lines that are complete (no ongoing stream writes).

function parseInline(raw: string): Span[] {
  const spans: Span[] = [];
  let i = 0;

  while (i < raw.length) {
    // Bold+italic: ***...*** or ___...___
    if ((raw[i] === "*" || raw[i] === "_") && raw[i + 1] === raw[i] && raw[i + 2] === raw[i]) {
      const d = raw[i];
      const delim = d + d + d;
      const end = raw.indexOf(delim, i + 3);
      if (end !== -1) {
        spans.push({ type: "bolditalic", content: raw.slice(i + 3, end) });
        i = end + 3;
        continue;
      }
    }

    // Bold: **...** or __...__
    if ((raw[i] === "*" || raw[i] === "_") && raw[i + 1] === raw[i] && raw[i + 2] !== raw[i]) {
      const d = raw[i];
      const delim = d + d;
      const end = raw.indexOf(delim, i + 2);
      if (end !== -1) {
        spans.push({ type: "bold", content: raw.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // Italic: *...* or _..._
    if ((raw[i] === "*" || raw[i] === "_") && raw[i + 1] !== raw[i]) {
      const d = raw[i];
      const end = raw.indexOf(d, i + 1);
      if (end !== -1) {
        spans.push({ type: "italic", content: raw.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Inline code: `...`
    if (raw[i] === "`") {
      const end = raw.indexOf("`", i + 1);
      if (end !== -1) {
        spans.push({ type: "code", content: raw.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Strikethrough: ~~...~~
    if (raw[i] === "~" && raw[i + 1] === "~") {
      const end = raw.indexOf("~~", i + 2);
      if (end !== -1) {
        spans.push({ type: "strike", content: raw.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // Link: [text](url)
    if (raw[i] === "[") {
      const cb = raw.indexOf("]", i + 1);
      if (cb !== -1 && raw[cb + 1] === "(") {
        const cp = raw.indexOf(")", cb + 2);
        if (cp !== -1) {
          spans.push({ type: "link", content: raw.slice(i + 1, cb), href: raw.slice(cb + 2, cp) });
          i = cp + 1;
          continue;
        }
      }
    }

    // Plain text until next special char
    let plain = "";
    while (i < raw.length && raw[i] !== "*" && raw[i] !== "_" && raw[i] !== "`" && raw[i] !== "~" && raw[i] !== "[") {
      plain += raw[i++];
    }
    if (plain) spans.push({ type: "text", content: plain });
  }

  return spans;
}

// ─── Inline renderer ──────────────────────────────────────────────────────────

function InlineSpan({ span, theme }: { span: Span; theme: Theme }) {
  switch (span.type) {
    case "bold":        return <Text bold color={theme.text}>{span.content}</Text>;
    case "italic":      return <Text italic color={theme.text}>{span.content}</Text>;
    case "bolditalic":  return <Text bold italic color={theme.text}>{span.content}</Text>;
    case "code":        return <Text color={theme.warning}>{" "}{span.content}{" "}</Text>;
    case "strike":      return <Text dimColor strikethrough color={theme.muted}>{span.content}</Text>;
    case "link":
      return (
        <>
          <Text color={theme.info} underline>{span.content}</Text>
          <Text color={theme.muted}> ({span.href})</Text>
        </>
      );
    default:            return <Text color={theme.text}>{span.content}</Text>;
  }
}

function InlineLine({ raw, theme }: { raw: string; theme: Theme }) {
  return (
    <>
      {parseInline(raw).map((span, i) => (
        <InlineSpan key={i} span={span} theme={theme} />
      ))}
    </>
  );
}

// ─── Block types ──────────────────────────────────────────────────────────────

type Block =
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "hr" }
  | { kind: "bullet"; text: string; depth: number }
  | { kind: "numbered"; text: string; n: number }
  | { kind: "blockquote"; text: string }
  | { kind: "code_block"; lines: string[]; lang: string }
  | { kind: "blank" }
  | { kind: "paragraph"; text: string };

// ─── Block parser ─────────────────────────────────────────────────────────────

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i++]);
      }
      blocks.push({ kind: "code_block", lines: codeLines, lang });
      i++;
      continue;
    }

    if (line.trim() === "")          { blocks.push({ kind: "blank" }); i++; continue; }
    if (/^[-=*]{3,}\s*$/.test(line.trim())) { blocks.push({ kind: "hr" }); i++; continue; }

    const h3 = line.match(/^###\s+(.*)/); if (h3) { blocks.push({ kind: "h3", text: h3[1] }); i++; continue; }
    const h2 = line.match(/^##\s+(.*)/);  if (h2) { blocks.push({ kind: "h2", text: h2[1] }); i++; continue; }
    const h1 = line.match(/^#\s+(.*)/);   if (h1) { blocks.push({ kind: "h1", text: h1[1] }); i++; continue; }

    // Setext headers
    if (i + 1 < lines.length) {
      if (/^={3,}\s*$/.test(lines[i + 1]))             { blocks.push({ kind: "h1", text: line }); i += 2; continue; }
      if (/^-{3,}\s*$/.test(lines[i + 1]) && line.trim()) { blocks.push({ kind: "h2", text: line }); i += 2; continue; }
    }

    const bq = line.match(/^>\s?(.*)/);
    if (bq) { blocks.push({ kind: "blockquote", text: bq[1] }); i++; continue; }

    const bullet = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (bullet) { blocks.push({ kind: "bullet", text: bullet[2], depth: Math.floor(bullet[1].length / 2) }); i++; continue; }

    const num = line.match(/^(\d+)\.\s+(.*)/);
    if (num) { blocks.push({ kind: "numbered", text: num[2], n: parseInt(num[1]) }); i++; continue; }

    blocks.push({ kind: "paragraph", text: line });
    i++;
  }

  return blocks;
}

// ─── Block renderers ──────────────────────────────────────────────────────────

function BlockRow({ block, theme }: { block: Block; theme: Theme }) {
  switch (block.kind) {
    case "blank":    return <Box height={0} />;
    case "hr":       return <Text color={theme.border}>{"─".repeat(60)}</Text>;
    case "h1":       return <Text bold color={theme.primary}>{"█ "}<InlineLine raw={block.text} theme={theme} /></Text>;
    case "h2":       return <Text bold color={theme.secondary}>{"▌ "}<InlineLine raw={block.text} theme={theme} /></Text>;
    case "h3":       return <Text bold color={theme.info}>{"╌ "}<InlineLine raw={block.text} theme={theme} /></Text>;
    case "blockquote":
      return (
        <Box>
          <Text color={theme.muted}>{"│ "}</Text>
          <Text italic color={theme.muted} wrap="wrap"><InlineLine raw={block.text} theme={theme} /></Text>
        </Box>
      );
    case "bullet": {
      const dot = ["●", "○", "◦"][Math.min(block.depth, 2)];
      return (
        <Box paddingLeft={block.depth * 2}>
          <Text color={theme.primary}>{dot} </Text>
          <Text color={theme.text} wrap="wrap"><InlineLine raw={block.text} theme={theme} /></Text>
        </Box>
      );
    }
    case "numbered":
      return (
        <Box>
          <Text color={theme.secondary} bold>{block.n}. </Text>
          <Text color={theme.text} wrap="wrap"><InlineLine raw={block.text} theme={theme} /></Text>
        </Box>
      );
    case "code_block":
      return (
        <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
          {block.lang ? <Text color={theme.muted} dimColor>{block.lang}</Text> : null}
          {block.lines.map((l, i) => <Text key={i} color={theme.warning}>{l}</Text>)}
        </Box>
      );
    case "paragraph":
      return <Text color={theme.text} wrap="wrap"><InlineLine raw={block.text} theme={theme} /></Text>;
    default:
      return null;
  }
}

// ─── Token-safety check ───────────────────────────────────────────────────────
// Returns true if a line has an unclosed Markdown opener (stream is mid-token).

function hasUnclosedToken(line: string): boolean {
  // Odd backticks → unclosed inline code
  if ((line.match(/`/g) ?? []).length % 2 !== 0) return true;

  // Odd ~~ pairs → unclosed strikethrough
  if ((line.match(/~~/g) ?? []).length % 2 !== 0) return true;

  // Check stars: strip all balanced ***…*** **…** *…* and see if any * remain
  let s = line
    .replace(/\*\*\*[^*]*\*\*\*/g, "")
    .replace(/\*\*[^*]*\*\*/g, "")
    .replace(/\*[^*\n]*\*/g, "");
  if (s.includes("*")) return true;

  // Same for underscores
  let u = line
    .replace(/___[^_]*___/g, "")
    .replace(/__[^_]*__/g, "")
    .replace(/_[^_\n]*_/g, "");
  if (u.includes("_")) return true;

  return false;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  /** Raw text — may be an incomplete stream */
  content: string;
  theme: Theme;
  /**
   * Set to true while the AI is actively streaming this message.
   * When true, the last (unfinished) line is rendered as plain text.
   */
  isStreaming?: boolean;
}

export function MarkdownRenderer({ content, theme, isStreaming = false }: Props) {
  // ── Split into "safe" complete lines and an unsafe partial tail ──────────
  const nlIdx = content.lastIndexOf("\n");
  const endsWithNewline = content.endsWith("\n");

  let safeText: string;
  let tail: string;

  if (isStreaming && !endsWithNewline) {
    // The last line is still being written → render it plain
    safeText = nlIdx >= 0 ? content.slice(0, nlIdx + 1) : "";
    tail     = nlIdx >= 0 ? content.slice(nlIdx + 1)    : content;
  } else {
    // Not streaming (or ends cleanly) — still protect against single-line
    // messages that have unclosed tokens (e.g. a lone *)
    const lines = content.split("\n");
    const last  = lines[lines.length - 1];
    if (!endsWithNewline && hasUnclosedToken(last)) {
      safeText = lines.slice(0, -1).join("\n") + (lines.length > 1 ? "\n" : "");
      tail     = last;
    } else {
      safeText = content;
      tail     = "";
    }
  }

  // Build the complete-line array (drop the trailing empty string from split)
  const completeLines = safeText.split("\n");
  if (completeLines[completeLines.length - 1] === "") completeLines.pop();

  const blocks = parseBlocks(completeLines);

  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => (
        <BlockRow key={idx} block={block} theme={theme} />
      ))}
      {/* Partial / unsafe line — always plain */}
      {tail ? <Text color={theme.text} wrap="wrap">{tail}</Text> : null}
    </Box>
  );
}