// src/modules/hallucination/promptGuards.ts
//
// Builds intent-specific hallucination guardrails injected into system prompts.
// Different intents have different hallucination risk profiles:
//
//   chat         — general; moderate risk (facts, dates, names)
//   search       — high risk (citations, URLs, statistics)
//   finance      — critical risk (prices, percentages, company data)
//   news         — high risk (events, quotes, dates)
//   document_ask — medium risk (page numbers, quotes)
//   code/bash    — medium risk (API names, syntax, versions)
//   weather      — low risk (delegated to API)
//
// These are APPENDED to the static core prompt so they don't break caching.
// They are short (<100 tokens) to minimise cache invalidation.

// ── Base guardrail (always included) ─────────────────────────────────────────

export const BASE_GUARDRAIL = `
HALLUCINATION PREVENTION:
- State uncertainty explicitly when unsure ("I'm not certain", "you may want to verify").
- Never invent specific numbers, dates, URLs, or citations you haven't verified.
- If asked about something outside your training data, say so rather than guessing.
- Prefer "I don't know" over a plausible-sounding fabrication.
`.trim();

// ── Intent-specific guardrails ────────────────────────────────────────────────

const INTENT_GUARDRAILS: Record<string, string> = {
  // Finance — highest stakes
  finance: `
FINANCE GUARDRAIL: Do not state specific stock prices, percentages, earnings figures, or market data unless they come from the provided tool output. If tool output is unavailable, clearly state that real-time data was not retrieved.
`.trim(),

  // Search — citation risk
  search: `
SEARCH GUARDRAIL: Cite only sources that appear in the provided search results. Do not invent URLs, author names, or publication dates. If a fact is not in the search results, say so.
`.trim(),

  // News — quotes and dates
  news: `
NEWS GUARDRAIL: Do not fabricate quotes, headline text, or event details. Summarise only what appears in the retrieved articles. Acknowledge when information may have changed since the fetch.
`.trim(),

  // Document Q&A — page/quote fabrication
  document_ask: `
DOCUMENT GUARDRAIL: Answer only from the provided document context. Do not invent page numbers, section titles, or quotes not present in the context. If the answer is not in the document, say so explicitly.
`.trim(),

  document_summarize: `
DOCUMENT GUARDRAIL: Summarise only content present in the document. Do not add context, statistics, or conclusions not in the source text.
`.trim(),

  // Deep research — citation heavy
  deep_search: `
RESEARCH GUARDRAIL: Only cite sources from the collected search results. Do not fabricate author names, journal names, publication dates, or DOIs. Mark speculation as such.
`.trim(),

  deep_research: `
RESEARCH GUARDRAIL: Only cite sources from the collected search results. Do not fabricate author names, journal names, publication dates, or DOIs. Mark speculation as such.
`.trim(),

  // Code generation — version/API fabrication
  bash: `
CODE GUARDRAIL: Use only real, documented command-line flags and APIs. Do not invent file paths, environment variables, or command syntax. If unsure, suggest the user check official docs.
`.trim(),

  // Chat — general facts
  chat: `
FACT GUARDRAIL: When stating historical dates, scientific facts, or biographical details, flag anything you're less than 90% confident about. Prefer "approximately" or "around" over invented precision.
`.trim(),
};

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Returns the guardrail text for a given intent.
 * Always includes the base guardrail; appends an intent-specific one if available.
 */
export function getGuardrailForIntent(intent: string): string {
  const specific = INTENT_GUARDRAILS[intent];
  if (specific) {
    return `${BASE_GUARDRAIL}\n\n${specific}`;
  }
  return BASE_GUARDRAIL;
}

/**
 * Returns ONLY the intent-specific guardrail (no base), for appending to
 * existing prompts that already include the base guardrail.
 */
export function getIntentSpecificGuardrail(intent: string): string {
  return INTENT_GUARDRAILS[intent] ?? "";
}

/**
 * Build an enhanced HALLUCINATION_PREVENTION constant that replaces the
 * simple string in constants.ts. This is used by promptAssembler.ts.
 */
export const ENHANCED_HALLUCINATION_PREVENTION = `
HALLUCINATION PREVENTION RULES:
1. Uncertainty disclosure: When you are less than confident about a factual claim, explicitly state your uncertainty.
2. No invented citations: Do not fabricate URLs, paper titles, author names, ISBNs, DOIs, or journal names.
3. No invented statistics: Do not state specific percentages, counts, or measurements you cannot verify from provided context.
4. No invented dates: Avoid stating specific dates for events unless you are highly confident they are correct.
5. Temporal honesty: If information might be outdated, say so. Do not claim to know current real-time information.
6. Prefer "I don't know": A clear "I don't know" is always better than a plausible-sounding fabrication.
7. Source attribution: When using retrieved data, attribute it. When generating from memory, flag that it is from training data.
8. Verify before asserting: If a claim would be easy to check but you cannot check it, say "I believe" or "as far as I know".
`.trim();
