// src/modules/deepSearch/planner.ts
//
// Given a user query, generates N focused sub-questions that together
// provide comprehensive coverage of the topic.

import type { AIProvider } from "../../providers/types.js";
import { getFastModel } from "../../providers/utils.js";
import type { SubQuery } from "./types.js";

const SYSTEM_PROMPT = `You are a research planner. Break down a user's research question into specific, targeted sub-questions that together will give comprehensive coverage of the topic.

Output ONLY a raw JSON array — no markdown, no explanation:
[
  { "question": "...", "rationale": "..." },
  ...
]

Rules:
1. Each question should be concrete and searchable.
2. Cover different angles: definitions, recent developments, comparisons, practical applications, controversies/limitations.
3. Avoid overlap — each question should retrieve different information.
4. 3-6 questions maximum.`;

export async function planQueries(
  provider: AIProvider,
  userQuery: string,
  maxQueries: number,
  model?: string,
): Promise<SubQuery[]> {
  const fastModel = model || getFastModel(provider.name);

  const result = await provider.chat(
    [
      {
        role: "user",
        content: `Research topic: "${userQuery}"\n\nGenerate ${maxQueries} focused sub-questions.`,
      },
    ],
    {
      model: fastModel,
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 600,
    },
  );

  try {
    const cleaned = result.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as SubQuery[];
    return parsed
      .filter((q) => typeof q.question === "string" && q.question.trim())
      .slice(0, maxQueries);
  } catch {
    // Fallback: use the original query as a single sub-question
    return [{ question: userQuery, rationale: "Direct search" }];
  }
}
