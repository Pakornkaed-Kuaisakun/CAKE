// src/modules/deepSearch/synthesizer.ts
//
// Takes the original query + all search hits and synthesizes a
// structured, well-cited research report using the full-capability model.

import type { AIProvider } from "../../providers/types.js";
import { getFullModel } from "../../providers/utils.js";
import type { SubQuery, SearchHit } from "./types.js";

function buildContext(hits: SearchHit[]): string {
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.title} (${h.source})\nURL: ${h.url}\n${h.snippet}`,
    )
    .join("\n\n");
}

function buildSubQuestionList(subQueries: SubQuery[]): string {
  return subQueries.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
}

const SYSTEM_PROMPT = `You are an expert research analyst. Synthesize the provided search results into a comprehensive, well-structured report.

Format the report in Markdown:
1. Start with a concise executive summary (2-3 sentences).
2. Use ## headers for main sections.
3. Cite sources using [N] notation matching the numbered sources provided.
4. Include a "Key findings" section with bullet points.
5. End with a "Sources" section listing the referenced URLs.
6. Be thorough but avoid padding. Prefer depth over breadth.
7. Highlight disagreements or gaps in the evidence where they exist.`;

export async function synthesizeReport(
  provider: AIProvider,
  userQuery: string,
  subQueries: SubQuery[],
  hits: SearchHit[],
  model?: string,
): Promise<string> {
  const fullModel = model || getFullModel(provider.name);

  if (hits.length === 0) {
    return `# Research Report: ${userQuery}\n\nNo search results were found for this query. Please try a different search term or check your internet connection.`;
  }

  const context = buildContext(hits);
  const subQuestionList = buildSubQuestionList(subQueries);

  const prompt = `Research topic: "${userQuery}"

Sub-questions investigated:
${subQuestionList}

Search results (${hits.length} sources):
${context}

Write a comprehensive research report on "${userQuery}" using the sources above.`;

  const result = await provider.chat([{ role: "user", content: prompt }], {
    model: fullModel,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.4,
    maxTokens: 4096,
  });

  return result.text;
}
