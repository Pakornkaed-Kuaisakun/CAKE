// src/agent/autoMemory.ts
//
// AutoMemory — makes ALL memory features work automatically without user commands.
//
// What it does on every conversation turn:
//   1. Auto-detect & record DECISIONS    (was: decision_record)
//   2. Auto-detect important FACTS       (was: memory_index)
//   3. Auto-start/end EPISODES           (was: episode_start / episode_end)
//   4. Auto-extract KEY ENTITIES         (people, projects, tasks)
//   5. Periodic REFLECTION               (was: self_reflect)
//   6. Cross-session CONTEXT INJECTION   (relevant past memories surface automatically)
//
// Design principles:
//   - ZERO latency on the critical path  (everything async/background)
//   - Smart filtering                    (skip trivial turns like "thanks", "ok")
//   - Adaptive thresholds               (more aggressive when topics are rich)
//   - Never interrupts the user

import type { AIProvider } from "../providers/types.js";
import { EpisodeStore, DecisionStore } from "../modules/memory/episodes.js";
import { MemoryManager } from "../modules/memory/index.js";
import { getFastModel } from "../providers/utils.js";
import { withTimeout } from "../shared/utils/utils.js";

// ── Config ────────────────────────────────────────────────────────────────────

export interface AutoMemoryConfig {
  /** Minimum input length to bother processing (skip "ok", "thanks") */
  minInputLength: number;
  /** Minimum response length to extract from */
  minResponseLength: number;
  /** How many turns between self-reflection runs */
  reflectionInterval: number;
  /** Confidence threshold to auto-record a decision (0-1) */
  decisionConfidence: number;
  /** Confidence threshold to auto-index a memory (0-1) */
  memoryConfidence: number;
  /** Auto-start episode when topic is rich enough */
  autoEpisode: boolean;
  /** Auto-end episode after N turns of inactivity on topic */
  episodeInactivityTurns: number;
  /** Custom storage directory for memory files */
  storageDir?: string;
  /** Maximum time to let one background turn block the queue */
  processingTimeoutMs: number;
}

export const DEFAULT_AUTO_MEMORY_CONFIG: AutoMemoryConfig = {
  minInputLength: 15,
  minResponseLength: 30,
  reflectionInterval: 20,
  decisionConfidence: 0.65,
  memoryConfidence: 0.55,
  autoEpisode: true,
  episodeInactivityTurns: 10,
  processingTimeoutMs: 30_000,
};

// ── Extraction result types ───────────────────────────────────────────────────

interface AutoExtractResult {
  hasDecision: boolean;
  decision?: string;
  rationale?: string;
  hasImportantFact: boolean;
  fact?: string;
  factType?: "person" | "project" | "task" | "preference" | "fact" | "event";
  suggestEpisodeTitle?: string; // non-null = should start an episode
  shouldEndEpisode?: boolean;
  confidence: number;
}

// ── Keyword fast-path guards ──────────────────────────────────────────────────

const TRIVIAL_PATTERNS = [
  /^(ok|okay|thanks?|thank you|sure|got it|alright|fine|yes|no|yep|nope|hi|hey|hello)\s*[.!?]?\s*$/i,
  /^(great|cool|nice|good|awesome|perfect|got it)\s*[.!?]?\s*$/i,
];

function isTrivial(text: string): boolean {
  return TRIVIAL_PATTERNS.some((p) => p.test(text.trim()));
}

// Decision signal words (fast pre-filter before LLM call)
const DECISION_SIGNALS = [
  "decided",
  "decision",
  "agree",
  "agreed",
  "resolution",
  "action item",
  "will do",
  "going to",
  "plan to",
  "commit",
  "choose",
  "selected",
  "ตกลง",
  "ตัดสินใจ",
  "เลือก",
  "เคาะ",
  "อนุมัติ",
];

// Important fact signal words
const FACT_SIGNALS = [
  "my name",
  "i am",
  "i'm",
  "i work",
  "i use",
  "we use",
  "our",
  "project",
  "task",
  "deadline",
  "requirement",
  "spec",
  "need to",
  "important",
  "critical",
  "remember",
  "note that",
  "key point",
  "ชื่อ",
  "โปรเจค",
  "งาน",
  "สำคัญ",
  "จำไว้",
];

// Episode start signals (rich topic engagement)
const EPISODE_START_SIGNALS = [
  "let's work on",
  "help me build",
  "i need to design",
  "planning to",
  "brainstorm",
  "let's discuss",
  "meeting about",
  "working on",
  "ช่วยออกแบบ",
  "วางแผน",
  "ประชุม",
  "ทำโปรเจค",
];

function hasAnySignal(text: string, signals: string[]): boolean {
  const lower = text.toLowerCase();
  return signals.some((s) => lower.includes(s));
}

// ── SYSTEM PROMPT for the single extraction LLM call ─────────────────────────

const EXTRACTION_SYSTEM = `
Extract memory signals. Reply JSON only:

Output format:
{"d":false,"f":false,"dt":null,"ft":null,"ft_type":null,"conf":0.5}

Fields:
- d (boolean): true if a firm decision was made
- f (boolean): true if an important fact was stated  
- dt (string|null): the decision text
- ft (string|null): the fact text
- ft_type: "person"|"project"|"task"|"preference"|"fact"|"event"|null
- conf (0.0-1.0): confidence score

Examples:
USER: "Let's go with PostgreSQL for this project"
→ {"d":true,"f":true,"dt":"Use PostgreSQL for the project","ft":"Project uses PostgreSQL","ft_type":"project","conf":0.9}

USER: "I prefer concise answers without bullet points"  
→ {"d":false,"f":true,"dt":null,"ft":"User prefers concise answers without bullet points","ft_type":"preference","conf":0.85}

USER: "ok thanks"
→ {"d":false,"f":false,"dt":null,"ft":null,"ft_type":null,"conf":0.1}

USER: "We decided to launch on Friday"
→ {"d":true,"f":false,"dt":"Launch scheduled for Friday","ft":null,"ft_type":null,"conf":0.8}

Skip greetings. Only record firm decisions and key facts.
`;

// ── AutoMemoryManager ─────────────────────────────────────────────────────────

export class AutoMemoryManager {
  private provider: AIProvider;
  private memory: MemoryManager;
  private episodeStore: EpisodeStore;
  private decisionStore: DecisionStore;
  private config: AutoMemoryConfig;
  private turnCount = 0;
  private currentTopicTurns = 0;
  private lastEpisodeId: string | null = null;
  private processingPromise: Promise<any> = Promise.resolve();

  constructor(provider: AIProvider, config: Partial<AutoMemoryConfig> = {}) {
    this.provider = provider;
    this.config = { ...DEFAULT_AUTO_MEMORY_CONFIG, ...config };
    this.memory = new MemoryManager(provider, this.config.storageDir);
    this.episodeStore = new EpisodeStore(this.config.storageDir);
    this.decisionStore = new DecisionStore(this.config.storageDir);
  }

  setProvider(provider: AIProvider): void {
    this.provider = provider;
    this.memory = new MemoryManager(provider, this.config.storageDir);
  }

  /**
   * Main entry point — call after EVERY chat turn.
   * Completely non-blocking (fire-and-forget).
   */
  processTurn(userInput: string, assistantResponse: string): void {
    // Fast guard: skip trivial turns
    if (
      isTrivial(userInput) ||
      userInput.length < this.config.minInputLength ||
      assistantResponse.length < this.config.minResponseLength
    ) {
      return;
    }

    // Queue processing sequentially so rapid back-to-back turns are processed in order
    this.processingPromise = this.processingPromise
      .then(() =>
        withTimeout(
          this._processAsync(userInput, assistantResponse),
          this.config.processingTimeoutMs,
        ),
      )
      .catch((err) => {
        if (process.env.DEBUG) {
          console.warn("[AutoMemory] processing error:", err?.message ?? err);
        }
      })
      .then(() => {
        this.processingPromise = Promise.resolve();
      });
  }

  /**
   * Async processing — runs entirely in background.
   */
  private async _processAsync(
    userInput: string,
    assistantResponse: string,
  ): Promise<void> {
    this.turnCount++;
    this.currentTopicTurns++;

    // 1. Fast keyword pre-filter to decide if LLM extraction is worth it
    const needsExtraction =
      hasAnySignal(userInput, DECISION_SIGNALS) ||
      hasAnySignal(userInput, FACT_SIGNALS) ||
      hasAnySignal(userInput, EPISODE_START_SIGNALS) ||
      hasAnySignal(assistantResponse, DECISION_SIGNALS) ||
      (userInput.length > 200 &&
        hasAnySignal(userInput, [
          ...DECISION_SIGNALS,
          ...FACT_SIGNALS,
          ...EPISODE_START_SIGNALS,
        ]));

    if (!needsExtraction) {
      // Still do background memory write for conversational continuity
      await this._rememberConversation(
        userInput,
        assistantResponse,
        this.lastEpisodeId,
      );
      return;
    }

    // 2. Single LLM call to extract everything at once
    const extracted = await this._extract(userInput, assistantResponse);
    if (!extracted) return;

    // 3. Run episode handling first so we have the correct episode ID for this turn
    const episodeId = await this._handleEpisode(extracted, userInput);

    // 4. Run other memory operations in parallel
    await Promise.allSettled([
      this._handleDecision(extracted, episodeId),
      this._handleFact(extracted, userInput),
      this._rememberConversation(userInput, assistantResponse, episodeId),
    ]);

    // 5. Periodic self-reflection (every N turns)
    if (this.turnCount % this.config.reflectionInterval === 0) {
      this._runReflection();
    }
  }

  /**
   * Single LLM call that extracts ALL signals at once.
   * Cheaper than multiple calls.
   */
  private async _extract(
    userInput: string,
    assistantResponse: string,
  ): Promise<AutoExtractResult | null> {
    const fastModel = getFastModel(this.provider.name);

    const content = `USER: ${userInput.slice(0, 500)}\n\nASSISTANT: ${assistantResponse.slice(0, 300)}`;

    try {
      const resp = await this.provider.chat([{ role: "user", content }], {
        model: fastModel,
        systemPrompt: EXTRACTION_SYSTEM,
        temperature: 0,
        maxTokens: 400,
      });

      const raw = resp.text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(raw);
      return {
        hasDecision: parsed.d ?? parsed.hasDecision ?? false,
        decision: parsed.dt ?? parsed.decision ?? null,
        rationale: parsed.rationale ?? null,
        hasImportantFact: parsed.f ?? parsed.hasImportantFact ?? false,
        fact: parsed.ft ?? parsed.fact ?? null,
        factType: parsed.ft_type ?? parsed.factType ?? null,
        suggestEpisodeTitle: parsed.ep ?? parsed.suggestEpisodeTitle ?? null,
        shouldEndEpisode: parsed.end ?? parsed.shouldEndEpisode ?? false,
        confidence: parsed.conf ?? parsed.confidence ?? 0.5,
      } as AutoExtractResult;
    } catch {
      return null;
    }
  }

  /** Auto-record decisions */
  private async _handleDecision(
    extracted: AutoExtractResult,
    episodeId: string | null,
  ): Promise<void> {
    if (
      !extracted.hasDecision ||
      !extracted.decision ||
      extracted.confidence < this.config.decisionConfidence
    ) {
      return;
    }

    // Link to memory entries
    let linkedMemoryIds: string[] = [];
    try {
      const entries = await this.memory.retrieveEntries(extracted.decision, 3);
      linkedMemoryIds = entries.map((e) => e.id);
    } catch {}

    this.decisionStore.addDecision(
      extracted.decision,
      extracted.rationale ?? undefined,
      episodeId ?? undefined,
      {
        recordedBy: "auto",
        linkedMemoryIds,
        confidence: extracted.confidence,
        timestamp: Date.now(),
      },
    );

    if (process.env.DEBUG) {
      console.log(
        `[AutoMemory] Decision recorded: "${extracted.decision.slice(0, 60)}"`,
      );
    }
  }

  /** Auto-index important facts */
  private async _handleFact(
    extracted: AutoExtractResult,
    userInput: string,
  ): Promise<void> {
    if (
      !extracted.hasImportantFact ||
      !extracted.fact ||
      extracted.confidence < this.config.memoryConfidence
    ) {
      return;
    }

    await this.memory.remember(extracted.fact, {
      source: "auto-extract",
      type: extracted.factType ?? "fact",
      confidence: extracted.confidence,
      rawInput: userInput.slice(0, 200),
    });

    if (process.env.DEBUG) {
      console.log(
        `[AutoMemory] Fact indexed [${extracted.factType}]: "${extracted.fact.slice(0, 60)}"`,
      );
    }
  }

  /** Auto-manage episodes */
  private async _handleEpisode(
    extracted: AutoExtractResult,
    userInput: string,
  ): Promise<string | null> {
    if (!this.config.autoEpisode) return this.lastEpisodeId;

    // Start a new episode if suggested
    if (extracted.suggestEpisodeTitle && !this.lastEpisodeId) {
      const episode = this.episodeStore.startEpisode(
        extracted.suggestEpisodeTitle,
        {
          autoStarted: true,
          trigger: userInput.slice(0, 100),
        },
      );
      this.lastEpisodeId = episode.id;
      this.currentTopicTurns = 0;

      if (process.env.DEBUG) {
        console.log(
          `[AutoMemory] Episode started: "${extracted.suggestEpisodeTitle}"`,
        );
      }
      return episode.id;
    }

    const currentId = this.lastEpisodeId;

    // Auto-end episode if topic concluded or inactive too long
    const shouldEnd =
      this.lastEpisodeId &&
      (extracted.shouldEndEpisode ||
        this.currentTopicTurns >= this.config.episodeInactivityTurns);

    if (shouldEnd && this.lastEpisodeId) {
      this.episodeStore.endEpisode(this.lastEpisodeId);

      if (process.env.DEBUG) {
        console.log(`[AutoMemory] Episode ended: ${this.lastEpisodeId}`);
      }

      this.lastEpisodeId = null;
      this.currentTopicTurns = 0;
    }

    return currentId;
  }

  /** Always remember conversation context (lightweight) */
  private async _rememberConversation(
    userInput: string,
    assistantResponse: string,
    episodeId: string | null,
  ): Promise<void> {
    // Only index if there's substantive content
    if (userInput.length < 30 || assistantResponse.length < 50) return;
    if (
      !hasAnySignal(userInput, DECISION_SIGNALS) &&
      !hasAnySignal(userInput, FACT_SIGNALS)
    )
      return; // skip if no signal

    const summary = `User: ${userInput.slice(0, 150)}\nAssistant: ${assistantResponse.slice(0, 150)}`;

    await this.memory.remember(summary, {
      source: "conversation",
      timestamp: Date.now(),
      episodeId: episodeId ?? undefined,
    });
  }

  /** Background self-reflection — improves memory quality over time */
  private _runReflection(): void {
    setImmediate(async () => {
      try {
        await this.memory.reflectAndUpdate(
          getFastModel(this.provider.name),
          10,
        );
        if (process.env.DEBUG) {
          console.log(
            `[AutoMemory] Self-reflection completed (turn ${this.turnCount})`,
          );
        }
      } catch {
        // Non-fatal
      }
    });
  }

  /**
   * Get relevant memories for context injection.
   * Called BEFORE generating a response to surface relevant past context.
   * Returns strings suitable for injecting into the system prompt.
   */
  async getRelevantContext(query: string): Promise<string[]> {
    try {
      return await this.memory.retrieve(query, 3);
    } catch {
      return [];
    }
  }

  /**
   * Get a brief status summary (for /memory command or debug).
   */
  getStatus(): string {
    const activeEpisode = this.episodeStore.getActiveEpisode();
    return [
      `Turns processed: ${this.turnCount}`,
      `Active episode: ${activeEpisode ? `"${activeEpisode.title}"` : "none"}`,
      `Current topic turns: ${this.currentTopicTurns}`,
    ].join("\n");
  }

  /** Reset episode tracking (e.g. on /clear) */
  resetSession(): void {
    if (this.lastEpisodeId) {
      this.episodeStore.endEpisode(this.lastEpisodeId);
    }
    this.lastEpisodeId = null;
    this.currentTopicTurns = 0;
  }
}
