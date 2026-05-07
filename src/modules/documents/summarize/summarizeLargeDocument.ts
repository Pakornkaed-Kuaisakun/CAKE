import type { AIProvider, ChatResult } from "../../../providers/types.js";

import { chunkText } from "../chunk/chunkText.js";
import { summarizeChunk } from "./summarizeChunk.js";
import { combineSummaries } from "./combineSummaries.js";

export async function summarizeLargeDocument(
  provider: AIProvider,
  text: string,
  model?: string,
): Promise<ChatResult> {
  // 1. แบ่งเอกสารเป็นส่วนๆ
  const chunks = chunkText(text, 6000, 500); // เพิ่มขนาด chunk เล็กน้อยเพื่อลดจำนวนรอบ

  // 2. สรุปทุกส่วนพร้อมกัน (Parallel)
  const summaryPromises = chunks.map((chunk) => 
    summarizeChunk(provider, chunk, model)
  );
  
  const results = await Promise.all(summaryPromises);
  const summaries = results.map(r => r.text);

  // 3. รวมสรุปทั้งหมดเป็นหนึ่งเดียว
  return combineSummaries(provider, summaries, model);
}

