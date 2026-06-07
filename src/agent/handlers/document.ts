import path from "path";
import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  readDocument,
  summarizeLargeDocument,
  chunkText,
  askDocument,
} from "../../modules/documents/index.js";
import {
  calculateScore,
  stripQuotes,
  formatChatResult,
} from "../../shared/utils/utils.js";

export async function handleReadDocument(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:read|open|show)\s+(.+)/i);
    if (!match) return formatChatResult("Please specify a document path.");

    const rawPath = stripQuotes(match[1]);
    const filePath = path.resolve(rawPath);
    const content = await readDocument(filePath);

    return {
      text: `[DOCUMENTS] ${rawPath}\n\n` + content.slice(0, 12000),
    };
  } catch (error: any) {
    return formatChatResult(`Failed to read document.\n${error.message}`);
  }
}

export async function handleSummarizeDocument(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:summarize|summary)\s+(.+)/i);
    if (!match) return formatChatResult("Please provide a file path");

    const rawPath = stripQuotes(match[1]);
    const filePath = path.resolve(rawPath);

    const content = await readDocument(filePath);
    const summary = await summarizeLargeDocument(provider, content, model);

    return {
      text: `[DOCUMENTS] Summary: ${rawPath}\n\n` + summary.text,
    };
  } catch (err: any) {
    return formatChatResult(`Failed to summarize document.\n${err.message}`);
  }
}

export async function handleAskDocument(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(
      /(?:ask|question)\s+["']?(.+?\.(?:pdf|docx|txt))["']?\s+(.+)/i,
    );

    if (!match) {
      // หากไม่มีชื่อไฟล์ ให้แนะนำสั้นๆ และบอกว่ากำลังจะเข้าสู่โหมด Chat ปกติ
      return formatChatResult(
        "I couldn't find a document to ask. To ask a specific file, use: ask <filename.pdf> <question>\n\n(Falling back to general chat...)",
      );
    }

    const rawPath = match[1].trim();
    const question = match[2].trim();
    const filePath = path.resolve(rawPath);

    const content = await readDocument(filePath);
    if (!content?.trim()) return formatChatResult("Document is empty");

    const chunks = chunkText(content, 6000, 500);
    const relevantChunks = chunks
      .map((chunk) => ({ chunk, score: calculateScore(chunk, question) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.chunk);

    const response = await askDocument(
      provider,
      relevantChunks.join("\n\n"),
      question,
      model,
    );

    return {
      text: `[DOCUMENTS] ${rawPath}\nQuestion: ${question}\n\n${response.text}`,
    };
  } catch (err: any) {
    return formatChatResult(`Failed to ask document.\n${err.message}`);
  }
}
