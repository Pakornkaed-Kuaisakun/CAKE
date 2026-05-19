// src/agent/complexityClassifier.ts

export type ComplexityTier = "trivial" | "simple" | "moderate" | "complex";

export interface ComplexityScore {
  tier: ComplexityTier;
  maxTokens: number;
  thinkingBudget: number;
  score: number; // 0-100
  signals: string[]; // for debugging
}

const TIER_CONFIG: Record<
  ComplexityTier,
  { maxTokens: number; thinkingBudget: number }
> = {
  trivial: { maxTokens: 256, thinkingBudget: 0 },
  simple: { maxTokens: 512, thinkingBudget: 0 },
  moderate: { maxTokens: 1024, thinkingBudget: 0 },
  complex: { maxTokens: 4096, thinkingBudget: 2048 },
};

// Signals that LOWER complexity (fast-exit)
const SIMPLE_PATTERNS = [
  /^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|sure|got it)\b/i,
  /^(what time|what day|what date)\b/i,
  /^(remind me|add task|create event|show my|list my)\b/i,
  /^(weather|news|email|calendar|todo)\s*$/i,
  /^(yes|no|y|n)\s*$/i,
];

// Signals that RAISE complexity
interface ComplexitySignal {
  pattern: RegExp;
  weight: number; // 0-25 points
  label: string;
}

const RAISING_SIGNALS: ComplexitySignal[] = [
  // Multi-step reasoning
  {
    pattern:
      /\b(step.by.step|walk me through|explain in detail|how does.+work)\b/i,
    weight: 20,
    label: "step-by-step",
  },
  // Code generation
  {
    pattern:
      /\b(write|implement|create|build|code|function|class|script)\b.*\b(that|which|to)\b/i,
    weight: 18,
    label: "code-gen",
  },
  // Comparative analysis
  {
    pattern:
      /\b(compare|versus|vs\.?|difference between|pros and cons|trade.?off)\b/i,
    weight: 15,
    label: "comparison",
  },
  // Mathematical or logical proof
  {
    pattern: /\b(prove|proof|derive|calculate|solve|algorithm|complexity)\b/i,
    weight: 20,
    label: "math-logic",
  },
  // Debugging
  {
    pattern:
      /\b(why (is|does|won't|doesn't)|debug|error|fix|broken|not working)\b/i,
    weight: 12,
    label: "debug",
  },
  // Architecture or design
  {
    pattern: /\b(design|architect|structure|system|pattern|best practice)\b/i,
    weight: 10,
    label: "architecture",
  },
  // Long chains ("and then... and then...")
  {
    pattern: /\band (then|also|additionally|furthermore)\b/gi,
    weight: 5,
    label: "chained-request",
  },
  // Ambiguity markers
  {
    pattern:
      /\b(it depends|complex|nuanced|multiple|various|different ways)\b/i,
    weight: 8,
    label: "ambiguity",
  },
  // Thai complex patterns
  {
    pattern: /วิเคราะห์|อธิบาย|เปรียบเทียบ|เหตุผล|ทำไม|อย่างไร/u,
    weight: 15,
    label: "thai-complex",
  },
];

// Length score — logarithmic, not linear
function lengthScore(len: number): number {
  if (len < 30) return 0;
  if (len < 60) return 5;
  if (len < 120) return 10;
  if (len < 250) return 15;
  return 20; // cap at 20 for very long inputs
}

export function classifyComplexity(input: string): ComplexityScore {
  const trimmed = input.trim();
  const signals: string[] = [];

  // Fast exit: trivially simple patterns
  if (SIMPLE_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      tier: "trivial",
      maxTokens: 256,
      thinkingBudget: 0,
      score: 0,
      signals: ["simple-pattern"],
    };
  }

  let score = 0;

  // Length component (logarithmic)
  const ls = lengthScore(trimmed.length);
  if (ls > 0) {
    score += ls;
    signals.push(`length(${trimmed.length}chars=+${ls})`);
  }

  // Raising signals
  for (const sig of RAISING_SIGNALS) {
    if (sig.pattern.test(trimmed)) {
      score += sig.weight;
      signals.push(`${sig.label}(+${sig.weight})`);
    }
  }

  // Question mark adds mild complexity
  if (trimmed.includes("?")) {
    score += 3;
    signals.push("question(+3)");
  }

  // DEBUG mode overrides everything
  if (process.env.CAKE_DEBUG === "true") {
    return {
      tier: "complex",
      maxTokens: 4096,
      thinkingBudget: 2048,
      score: 100,
      signals: ["debug-mode"],
    };
  }

  // Map score to tier
  let tier: ComplexityTier;
  if (score < 10) tier = "trivial";
  else if (score < 20) tier = "simple";
  else if (score < 35) tier = "moderate";
  else tier = "complex";

  return {
    tier,
    ...TIER_CONFIG[tier],
    score,
    signals,
  };
}
