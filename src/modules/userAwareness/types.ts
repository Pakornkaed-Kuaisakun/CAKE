export type SignalCategory =
  | "habit" // recurring behaviors: "every morning I...", "I always..."
  | "preference" // likes/dislikes: "I prefer X", "I hate Y"
  | "lifestyle" // life context: diet, schedule, location, work style
  | "skill" // domain expertise: "I'm a developer", "I know Python"
  | "goal" // stated objectives: "I'm trying to...", "my goal is..."
  | "personality" // communication style: formal/casual, verbose/terse
  | "prompt_style" // how they prompt: often uses code blocks, bullet lists, etc.
  | "context"; // background facts: family, job, city, timezone

export interface UserSignal {
  id: string;
  category: SignalCategory;
  /** The extracted fact in plain English */
  fact: string;
  /** Confidence 0-1 based on how explicitly/repeatedly stated */
  confidence: number;
  /** How many times this has been reinforced */
  reinforcements: number;
  /** ISO timestamps: first observed, last seen */
  firstSeen: string;
  lastSeen: string;
  /** Source snippet (truncated) that yielded this signal */
  sourceSnippet: string;
}

export interface UserProfile {
  /** Deduplicated, ranked signals */
  signals: UserSignal[];
  /** Rolling summary generated from signals - injected into system prompt */
  summary: string;
  /** Total conversation turns observed */
  turnsObserved: number;
  lastUpdated: string;
}

export interface ExtractionResult {
  /** New signals extracted from this turn */
  newSignals: Omit<
    UserSignal,
    "id" | "firstSeen" | "lastSeen" | "reinforcements"
  >[];
  /** IDs of existing signals reinforced by this turn */
  reinforcedIds: string[];
}
