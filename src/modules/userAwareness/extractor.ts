// src/modules/userAwareness/extractor.ts
//
// Uses a fast LLM call to extract structured user signals from a conversation turn.
// Designed to be called async/non-blocking so it never slows down responses.
//
// The extraction prompt is kept tiny and deterministic (temperature 0, small output).
// We batch user + assistant together so the model sees both sides of intent.

import type { AIProvider } from "../../providers/types.js";
import { getFastModel } from "../../providers/utils.js";
import type { ExtractionResult, SignalCategory } from "./types.js";
import type { UserSignal } from "./types.js";
import { loadProfile } from "./store.js";

// ── Extraction prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a user-modeling engine. Extract structured facts about the USER from a conversation turn.
Output ONLY a raw JSON object — no markdown, no explanation:
{
  "new": [
    { "category": "<category>", "fact": "<plain English fact>", "confidence": <0.0-1.0>, "snippet": "<≤60 char source>" }
  ],
  "reinforce": ["<fact_id_1>", "<fact_id_2>"]
}

Categories:
  habit      — recurring behaviors or routines ("wakes at 6am", "exercises daily")
  preference — explicit likes/dislikes ("prefers dark mode", "dislikes verbose answers")
  lifestyle  — life context: diet, location, schedule, family ("vegetarian", "works remotely")
  skill      — domain expertise ("writes TypeScript", "knows Docker")
  goal       — stated objectives ("learning Rust", "building a startup")
  personality — communication style ("prefers bullet points", "likes concise answers")
  prompt_style — how they prompt ("often asks for code", "uses code blocks")
  context    — background facts ("lives in Bangkok", "has 2 kids")

Rules:
1. Only extract CLEAR signals from the USER message — not the assistant.
2. Skip vague/generic statements ("I want help", "thanks").
3. Confidence: 0.9 if explicit statement, 0.6 if strongly implied, 0.4 if weakly implied.
4. "reinforce" contains IDs of EXISTING signals that this turn confirms (from the profile below).
5. If nothing meaningful: return { "new": [], "reinforce": [] }`;

// ── Extractor ─────────────────────────────────────────────────────────────────

export async function extractSignals(
  provider: AIProvider,
  userMessage: string,
  assistantResponse: string,
  existingSignals: Pick<UserSignal, "id" | "category" | "fact">[],
  model?: string,
): Promise<ExtractionResult> {
  const fastModel = model || getFastModel(provider.name);

  // Summarize existing signals compactly so the LLM can identify reinforcements
  const profileSummary =
    existingSignals.length > 0
      ? existingSignals
          .slice(0, 30) // only top 30 to keep prompt small
          .map((s) => `[${s.id.slice(0, 8)}] ${s.category}: ${s.fact}`)
          .join("\n")
      : "(none yet)";

  const userContent = `EXISTING PROFILE (for reinforce matching only):
${profileSummary}

USER MESSAGE:
${userMessage.slice(0, 600)}

ASSISTANT RESPONSE (context only):
${assistantResponse.slice(0, 300)}`;

  let result: ExtractionResult = { newSignals: [], reinforcedIds: [] };

  try {
    const response = await provider.chat(
      [{ role: "user", content: userContent }],
      {
        model: fastModel,
        systemPrompt: SYSTEM_PROMPT,
        temperature: 0,
        maxTokens: 400,
      },
    );

    const cleaned = response.text.replace(/```json|```/g, "").trim();

    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed.new)) {
      result.newSignals = parsed.new
        .filter(
          (n: any) =>
            typeof n.fact === "string" &&
            n.fact.length > 5 &&
            typeof n.category === "string",
        )
        .map((n: any) => ({
          category: n.category as SignalCategory,
          fact: String(n.fact).slice(0, 200),
          confidence: Math.min(1, Math.max(0, Number(n.confidence) || 0.5)),
          sourceSnippet: String(n.snippet || userMessage).slice(0, 80),
        }));
    }

    if (Array.isArray(parsed.reinforce)) {
      result.reinforcedIds = parsed.reinforce
        .filter((id: any) => typeof id === "string")
        .map((id: string) => {
          // The LLM may give 8-char prefix — match against full IDs
          const full = existingSignals.find(
            (s) => s.id.startsWith(id) || s.id === id,
          );
          return full?.id ?? null;
        })
        .filter(Boolean) as string[];
    }
  } catch {
    // Extraction is always best-effort — never throw
  }

  return result;
}

// ── Summary generator ─────────────────────────────────────────────────────────
//
// Regenerate the summary paragraph when the profile changes significantly.
// Called lazily — only when signal count changes by ≥5.

export async function generateProfileSummary(
  provider: AIProvider,
  signals: Pick<UserSignal, "category" | "fact" | "confidence">[],
  model?: string,
): Promise<string> {
  if (signals.length === 0) return "";

  const fastModel = model || getFastModel(provider.name);

  const signalList = signals
    .filter((s) => s.confidence >= 0.4)
    .slice(0, 40)
    .map((s) => `[${s.category}] ${s.fact}`)
    .join("\n");

  try {
    const response = await provider.chat(
      [
        {
          role: "user",
          content: `Summarize these user facts into 3-5 concise sentences for an AI assistant to personalize its responses. Focus on actionable context. Be factual, not flattering.\n\n${signalList}`,
        },
      ],
      {
        model: fastModel,
        temperature: 0.2,
        maxTokens: 200,
      },
    );
    return response.text.trim();
  } catch {
    return "";
  }
}
