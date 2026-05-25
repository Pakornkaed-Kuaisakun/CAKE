// src/modules/hallucination/detector.ts
//
// Zero-latency heuristic detector. No LLM calls — pure pattern matching.
// Scans the model response for signals associated with confabulation:
//   • Overly specific unverifiable numbers/dates
//   • Fake citation patterns ("According to [Source]")
//   • Fabrication hedges the model accidentally reveals
//   • Temporal claims ("currently", "as of 2024")
//   • Contradictory confidence ("definitely" + vague claim)
//   • ISBN/DOI/URL-shaped strings that look invented
//   • Specific statistics without stated source

import type {
  HallucinationScore,
  HallucinationRisk,
  SuspectClaim,
  ClaimType,
} from "./types.js";

// ── Pattern libraries ─────────────────────────────────────────────────────────

/** Phrases that suggest the model is inventing with high confidence */
const FABRICATION_SIGNALS: Array<{
  pattern: RegExp;
  label: string;
  weight: number;
}> = [
  // Overclaiming about real-time knowledge
  {
    pattern: /\bas of (today|right now|this moment|currently)\b/gi,
    label: "real-time claim",
    weight: 0.7,
  },
  // Fake study / research citations
  {
    pattern: /\b(a|one) (?:2\d{3}) study (?:by|from|in|published)\b/gi,
    label: "unverified study",
    weight: 0.65,
  },
  {
    pattern: /\baccording to (?:a |the )?(?:recent|new|latest|2\d{3})\b/gi,
    label: "unverified source",
    weight: 0.55,
  },
  // Invented URLs
  {
    pattern:
      /https?:\/\/(?!(?:www\.)?(?:wikipedia|github|npmjs|nodejs)\b)\S{10,}/g,
    label: "invented URL",
    weight: 0.6,
  },
  // Precise statistics with no source
  {
    pattern: /\b\d{1,3}(?:\.\d+)?%\b.*\b(?:of|are|were|have)\b/gi,
    label: "unsourced statistic",
    weight: 0.45,
  },
  // Invented ISBN/DOI
  {
    pattern: /\bISBN[-:\s]?\d[\d\-]{8,}\d\b/gi,
    label: "invented ISBN",
    weight: 0.8,
  },
  { pattern: /\bdoi:\s*10\.\d{4,}\//gi, label: "invented DOI", weight: 0.75 },
  // "researchers found" without naming who
  {
    pattern: /\bresearchers (?:found|discovered|showed|demonstrated) that\b/gi,
    label: "unnamed researchers",
    weight: 0.5,
  },
  // Overly specific "X was born/died on" dates for non-famous entities
  {
    pattern:
      /\bwas (?:born|founded|established|created) (?:on|in) \w+ \d{1,2},? \d{4}\b/gi,
    label: "specific founding date",
    weight: 0.4,
  },
  // "Exactly N" claims
  { pattern: /\bexactly \d{3,}\b/gi, label: "exact large number", weight: 0.5 },
  // "The [specific model/version number]" hallucination
  {
    pattern: /\bversion \d+\.\d+\.\d+\b/gi,
    label: "specific version claim",
    weight: 0.35,
  },
];

/** Phrases that signal the model itself is uncertain (good — already hedged) */
const HEDGING_SIGNALS: RegExp[] = [
  /\bI('m| am) not (sure|certain|confident)\b/gi,
  /\bI (may|might|could) be (wrong|mistaken|incorrect)\b/gi,
  /\bI (don't|cannot|can't) (verify|confirm|guarantee)\b/gi,
  /\bto (the best of )?my knowledge\b/gi,
  /\byou (should|may want to) (verify|check|confirm)\b/gi,
  /\bI'd recommend (checking|verifying|confirming)\b/gi,
  /\bI (don't|do not) have (access|information) (to|about)\b/gi,
  /\bmy (training|knowledge) (cutoff|data)\b/gi,
  /\bplease (verify|double-check|confirm)\b/gi,
  /\bthis (may|might|could) (not|be) (accurate|current|up-to-date)\b/gi,
];

/** Temporal claims that indicate potentially stale/invented info */
const TEMPORAL_PATTERNS: RegExp[] = [
  /\bcurrently\b/gi,
  /\bas of \d{4}\b/gi,
  /\bthe (?:latest|current|newest|most recent)\b/gi,
  /\bright now\b/gi,
  /\bthis year\b/gi,
  /\blast (?:year|month|week)\b/gi,
];

/** Citation-like patterns that are often fabricated */
const CITATION_PATTERNS: RegExp[] = [
  /\[?\d+\]|\(\d{4}\)/g, // [1] or (2023)
  /\((?:[A-Z][a-z]+(?:,? )?){1,3}\d{4}\)/g, // (Smith et al. 2023)
  /et al\./gi,
  /\bop\. cit\b/gi,
  /\bibid\b/gi,
];

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreToRisk(score: number): HallucinationRisk {
  if (score >= 0.75) return "critical";
  if (score >= 0.5) return "high";
  if (score >= 0.25) return "medium";
  return "low";
}

function detectSuspectClaims(text: string): SuspectClaim[] {
  const claims: SuspectClaim[] = [];

  for (const { pattern, label, weight } of FABRICATION_SIGNALS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const matchText = match[0];
      claims.push({
        text: matchText,
        type: inferClaimType(label),
        riskScore: weight,
        reason: label,
        startIndex: match.index,
        endIndex: match.index + matchText.length,
      });
      // Prevent infinite loop on zero-length matches
      if (pattern.lastIndex === match.index) pattern.lastIndex++;
    }
  }

  // Deduplicate overlapping matches (keep highest score)
  return deduplicateClaims(claims);
}

function inferClaimType(label: string): ClaimType {
  if (label.includes("statistic") || label.includes("number"))
    return "statistical";
  if (
    label.includes("URL") ||
    label.includes("ISBN") ||
    label.includes("DOI") ||
    label.includes("source")
  )
    return "citation";
  if (label.includes("temporal") || label.includes("real-time"))
    return "temporal";
  if (label.includes("date") || label.includes("founding")) return "factual";
  return "factual";
}

function deduplicateClaims(claims: SuspectClaim[]): SuspectClaim[] {
  const result: SuspectClaim[] = [];
  for (const claim of claims) {
    const overlap = result.find(
      (c) => c.startIndex <= claim.endIndex && claim.startIndex <= c.endIndex,
    );
    if (!overlap) {
      result.push(claim);
    } else if (claim.riskScore > overlap.riskScore) {
      result.splice(result.indexOf(overlap), 1, claim);
    }
  }
  return result;
}

function detectHedging(text: string): boolean {
  return HEDGING_SIGNALS.some((p) => p.test(text));
}

function detectTemporalRisk(text: string): boolean {
  return TEMPORAL_PATTERNS.some((p) => p.test(text));
}

function detectCitationRisk(text: string): boolean {
  const citationCount = CITATION_PATTERNS.reduce((count, p) => {
    const matches = text.match(p);
    return count + (matches?.length ?? 0);
  }, 0);
  return citationCount >= 2; // 2+ citation-like patterns without context is suspicious
}

function detectFabricationSignals(text: string): string[] {
  return FABRICATION_SIGNALS.filter(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  }).map(({ label }) => label);
}

// ── Length-based priors ───────────────────────────────────────────────────────
// Longer responses have statistically more fabrication risk per claim.

function lengthRiskPrior(text: string): number {
  const words = text.split(/\s+/).length;
  if (words < 50) return 0.0;
  if (words < 150) return 0.05;
  if (words < 400) return 0.1;
  if (words < 800) return 0.15;
  return 0.2; // very long responses are harder to verify
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Synchronously score a model response for hallucination risk.
 * No LLM calls — pure regex + heuristics, ~0ms latency.
 */
export function detectHallucination(
  response: string,
  input?: string,
): HallucinationScore {
  const suspectClaims = detectSuspectClaims(response);
  const hedgingPresent = detectHedging(response);
  const temporalRisk = detectTemporalRisk(response);
  const citationRisk = detectCitationRisk(response);
  const fabricationSignals = detectFabricationSignals(response);

  // Aggregate score
  let score = lengthRiskPrior(response);

  // Add claim scores (diminishing returns for more claims)
  for (let i = 0; i < suspectClaims.length; i++) {
    const weight = 1 / (i + 1); // first claim counts fully, subsequent less
    score += suspectClaims[i].riskScore * weight * 0.4;
  }

  if (temporalRisk) score += 0.15;
  if (citationRisk) score += 0.2;

  // Model's own hedging reduces the risk score
  if (hedgingPresent) score = Math.max(0, score - 0.2);

  // Cap at 1.0
  score = Math.min(1, score);

  return {
    overall: score,
    risk: scoreToRisk(score),
    suspectClaims,
    hedgingPresent,
    fabricationSignals,
    temporalRisk,
    citationRisk,
  };
}

/**
 * Quick pass — returns true if the response should be flagged for review.
 * Use this on the hot path when full scoring isn't needed.
 */
export function shouldFlag(response: string, threshold = 0.5): boolean {
  const score = detectHallucination(response);
  return score.overall >= threshold;
}
