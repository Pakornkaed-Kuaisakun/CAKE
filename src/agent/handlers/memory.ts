import path from "path";
import type { AIProvider, ChatResult } from "../../providers/types.js";
import { readDocument, chunkText } from "../../modules/documents/index.js";
import { MemoryManager } from "../../modules/memory/index.js";
import { text } from "../utils/text.js";

export async function handleIndexDocument(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:index|learn|remember)\s+(.+)/i);
    if (!match) return text("Please specify a document to index.");

    const rawPath = match[1].trim().replace(/^["']|["']$/g, "");
    const filePath = path.resolve(rawPath);
    
    const content = await readDocument(filePath);
    const chunks = chunkText(content, 2000, 200); // ใช้ chunk เล็กสำหรับการเก็บจำ

    const memory = new MemoryManager(provider);
    
    // Index แต่ละ chunk ลงใน Vector Store
    for (const chunk of chunks) {
      await memory.remember(chunk, { 
        source: "file-index", 
        fileName: path.basename(filePath),
        fullPath: filePath 
      });
    }

    return text(`✅ Learned ${chunks.length} segments from ${path.basename(filePath)}. I will remember this context in future conversations.`);
  } catch (error: any) {
    return text(`Failed to index document.\n${error.message}`);
  }
}

export async function handleForgetMemory(
  provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  // ฟีเจอร์ลบความจำ (Optional)
  return text("Memory clearing feature is not implemented yet but can be done by deleting data/memory/vectors.json");
}
