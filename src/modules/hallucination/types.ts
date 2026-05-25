// src/modules/hallucination/types.ts
//
// Shared types for the hallucination prevention system.

export type HallucinationRisk = "low" | "medium" | "high" | "critical";

export type ClaimType =
  | "factual" // verifiable facts: dates, numbers, names
  | "statistical" // percentages, counts, measurements
  | "citation" // references to sources, papers, URLs
  | "causal" // "X causes Y" reasoning
  | "temporal" // time-sensitive claims ("currently", "as of")
  | "identity" // claims about who/what something is
  | "procedural" // step-by-step instructions
  | "speculative"; // guesses, predictions

export interface SuspectClaim {
  text: string;
  type: ClaimType;
  riskScore: number; // 0-1
  reason: string;
  startIndex: number;
  endIndex: number;
}

export interface HallucinationScore {
  overall: number; // 0-1 (0 = clean, 1 = very likely hallucinating)
  risk: HallucinationRisk;
  suspectClaims: SuspectClaim[];
  hedgingPresent: boolean; // model already expressed uncertainty
  fabricationSignals: string[]; // high-confidence fabrication patterns detected
  temporalRisk: boolean; // contains "currently" / "as of" type claims
  citationRisk: boolean; // contains unverifiable citations
}

export interface HallucinationCheckOptions {
  /** Skip expensive pattern checks for short responses */
  skipPatternCheck?: boolean;
  /** Threshold above which to add hedging to the response */
  hedgingThreshold?: number;
  /** Whether to log detection results */
  verbose?: boolean;
}

export interface HallucinationEvent {
  id: string;
  timestamp: string;
  input: string;
  response: string;
  score: HallucinationScore;
  hedged: boolean;
  /** The final response after post-processing */
  finalResponse: string;
}

export interface HallucinationStats {
  totalChecked: number;
  totalFlagged: number; // risk >= medium
  totalHedged: number; // responses that had hedging added
  avgScore: number;
  riskDistribution: Record<HallucinationRisk, number>;
  topPatterns: Array<{ pattern: string; count: number }>;
  lastUpdated: string;
}
