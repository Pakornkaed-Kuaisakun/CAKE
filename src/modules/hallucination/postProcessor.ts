// src/modules/hallucination/postProcessor.ts
//
// Adds hedging language to responses that score above the risk threshold.
// Strategy: prepend a brief uncertainty notice ONLY when:
//   1. The model didn't already hedge itself
//   2. The score exceeds the configured threshold
//   3. The response contains verifiable-sounding factual claims
//
// We intentionally do NOT rewrite the response — that would require another
// LLM call and could introduce more errors. We prepend/append a notice instead.

import type { HallucinationScore, HallucinationRisk } from "./types.js";

// ── Hedge templates per risk level ────────────────────────────────────────────

const HEDGES: Record<HallucinationRisk, string[]> = {
  low: [], // No hedging needed at low risk
  medium: [
    "⚠️ Some details below may be approximate — please verify important facts before acting on them.\n\n",
    "ℹ️ Note: I'm less certain about some specifics in this response. Double-check key details.\n\n",
  ],
  high: [
    "⚠️ **Verify before using:** This response contains specific claims I can't fully verify. Cross-reference with authoritative sources.\n\n",
    "⚠️ **Caution:** Some details below may be inaccurate or outdated. Please verify specific facts, statistics, and citations.\n\n",
  ],
  critical: [
    "🚨 **High uncertainty:** This response contains claims that may be fabricated or inaccurate. I recommend treating specific facts, dates, statistics, and citations with significant skepticism and verifying independently.\n\n",
  ],
};

/** Foot-notes appended for citation risk */
const CITATION_FOOTNOTE =
  "\n\n---\n*Note: Any citations, references, or URLs in this response have not been verified and may be inaccurate.*";

/** Foot-note for temporal risk */
const TEMPORAL_FOOTNOTE =
  "\n\n---\n*Note: Time-sensitive information (current state, recent events) may be outdated as of my knowledge cutoff.*";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickHedge(risk: HallucinationRisk): string {
  const options = HEDGES[risk];
  if (!options || options.length === 0) return "";
  // Deterministic pick based on string hash (avoids random in tests)
  return options[0];
}

function isToolOutput(response: string): boolean {
  // Tool outputs start with [TAG] and shouldn't be hedged
  return /^\[(?:FILES|CALENDAR|EMAIL|TODO|NEWS|WEATHER|SEARCH|BASH|DOCUMENTS|VDB|MCP|LOCKER|AGENT|PIPELINE|CRON|VISION|SECURITY|FINANCE|FOUND)\]/.test(
    response.trim(),
  );
}

function isShortResponse(response: string): boolean {
  return response.trim().split(/\s+/).length < 30;
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface PostProcessResult {
  response: string;
  hedged: boolean;
  hedgeType: "prefix" | "suffix" | "both" | "none";
}

/**
 * Post-process a model response: add hedging language if warranted.
 *
 * @param response   The raw model output
 * @param score      The hallucination score from detectHallucination()
 * @param threshold  Minimum score to trigger hedging (default 0.4)
 */
export function postProcess(
  response: string,
  score: HallucinationScore,
  threshold = 0.4,
): PostProcessResult {
  // Skip tool outputs and very short responses
  if (isToolOutput(response) || isShortResponse(response)) {
    return { response, hedged: false, hedgeType: "none" };
  }

  // Skip if model already expressed uncertainty
  if (score.hedgingPresent) {
    return { response, hedged: false, hedgeType: "none" };
  }

  // Skip if below threshold
  if (score.overall < threshold) {
    return { response, hedged: false, hedgeType: "none" };
  }

  let result = response;
  let hedgeType: PostProcessResult["hedgeType"] = "none";
  let hedged = false;

  // Prepend risk hedge
  const prefix = pickHedge(score.risk);
  if (prefix) {
    result = prefix + result;
    hedgeType = "prefix";
    hedged = true;
  }

  // Append footnotes for specific risk types
  const suffixes: string[] = [];
  if (score.citationRisk) suffixes.push(CITATION_FOOTNOTE);
  if (score.temporalRisk && score.risk !== "low")
    suffixes.push(TEMPORAL_FOOTNOTE);

  if (suffixes.length > 0) {
    result += suffixes.join("");
    hedgeType = hedgeType === "prefix" ? "both" : "suffix";
    hedged = true;
  }

  return { response: result, hedged, hedgeType };
}

/**
 * Generate a short inline uncertainty marker for specific suspect claims.
 * Used in verbose mode to annotate individual claims in the response.
 */
export function annotateHighRiskClaims(
  response: string,
  score: HallucinationScore,
): string {
  if (score.risk === "low" || score.suspectClaims.length === 0) return response;

  // Only annotate in very high-risk cases
  if (score.risk !== "critical") return response;

  let result = response;
  let offset = 0;

  // Sort by startIndex to process in order
  const claims = [...score.suspectClaims]
    .filter((c) => c.riskScore >= 0.6)
    .sort((a, b) => a.startIndex - b.startIndex);

  for (const claim of claims) {
    const marker = " ⚠️";
    const insertAt = claim.endIndex + offset;
    result = result.slice(0, insertAt) + marker + result.slice(insertAt);
    offset += marker.length;
  }

  return result;
}
