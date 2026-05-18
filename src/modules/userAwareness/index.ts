// src/modules/userAwareness/index.ts
//
// UserAwarenessManager — passive learning from every conversation turn.
//
// Usage inside CakeAgent.runChat():
//   1. After getting the AI response, call manager.observe(userMsg, assistantMsg)
//      → non-blocking, runs in background
//   2. Before building chatOpts, call manager.getContextString(userInput)
//      → returns a few lines of personalized context to append to systemPrompt
//
// The learning is:
//   • Passive — user never needs to do anything special
//   • Incremental — each turn adds/reinforces signals
//   • Persistent — survives restarts via ~/.cake/user-profile.json
//   • Contextual — only relevant signals injected per query

import type { AIProvider } from "../../providers/types.js";
import {
  saveProfile,
  mergeSignals,
  getRelevantSignals,
  profileFilePath,
  loadProfile,
} from "./store.js";
import { extractSignals, generateProfileSummary } from "./extractor.js";
import type { UserProfile } from "./types.js";

export type { UserProfile, UserSignal, SignalCategory } from "./types.js";

// Regenerate summary every N new signals
const SUMMARY_REGEN_INTERVAL = 5;

export class UserAwarenessManager {
  private provider: AIProvider;
  private model: string | undefined;
  private profile: UserProfile;
  /** Count of new signals since last summary regen */
  private newSinceLastSummary = 0;
  /** Debounce: skip extraction for very short messages */
  private readonly MIN_MESSAGE_LENGTH = 12;

  constructor(provider: AIProvider, model?: string) {
    this.provider = provider;
    this.model = model;
    this.profile = loadProfile();
  }

  setProvider(provider: AIProvider, model?: string): void {
    this.provider = provider;
    this.model = model;
  }

  // ── Passive observation ────────────────────────────────────────────────────

  /**
   * Call after every chat turn. Runs extraction in the background —
   * never awaited by the main path, so it adds zero latency.
   */
  observe(userMessage: string, assistantResponse: string): void {
    if (userMessage.length < this.MIN_MESSAGE_LENGTH) return;

    // Fire-and-forget
    this._observeAsync(userMessage, assistantResponse).catch(() => {});
  }

  private async _observeAsync(
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    try {
      const existing = this.profile.signals.map((s) => ({
        id: s.id,
        category: s.category,
        fact: s.fact,
      }));

      const extraction = await extractSignals(
        this.provider,
        userMessage,
        assistantResponse,
        existing,
        this.model,
      );

      if (
        extraction.newSignals.length === 0 &&
        extraction.reinforcedIds.length === 0
      ) {
        // Still bump turnsObserved
        this.profile = mergeSignals(this.profile, [], []);
        saveProfile(this.profile);
        return;
      }

      this.profile = mergeSignals(
        this.profile,
        extraction.newSignals,
        extraction.reinforcedIds,
      );

      this.newSinceLastSummary += extraction.newSignals.length;

      // Regenerate summary periodically
      if (this.newSinceLastSummary >= SUMMARY_REGEN_INTERVAL) {
        this.newSinceLastSummary = 0;
        const summary = await generateProfileSummary(
          this.provider,
          this.profile.signals,
          this.model,
        );
        if (summary) this.profile.summary = summary;
      }

      saveProfile(this.profile);
    } catch {
      // Always silent — awareness is a bonus, never a blocker
    }
  }

  // ── Context injection ──────────────────────────────────────────────────────

  /**
   * Returns a short string to append to the system prompt.
   * Empty string if the profile has too few signals or low confidence.
   */
  getContextString(query: string): string {
    if (this.profile.signals.length < 3) return "";

    const relevant = getRelevantSignals(this.profile, query, 12);
    if (relevant.length === 0) return "";

    const lines = relevant
      .filter((s) => s.confidence >= 0.4)
      .map((s) => `• [${s.category}] ${s.fact}`)
      .join("\n");

    if (!lines) return "";

    return (
      `\n\n── User Profile (learned from past interactions) ──\n` +
      lines +
      `\nAdapt your response style and content to match the above.`
    );
  }

  /**
   * Returns the full profile summary paragraph (if generated).
   */
  getSummary(): string {
    return this.profile.summary;
  }

  // ── Inspection / management ───────────────────────────────────────────────

  getProfile(): UserProfile {
    return { ...this.profile };
  }

  clearProfile(): void {
    this.profile = {
      signals: [],
      summary: "",
      turnsObserved: 0,
      lastUpdated: new Date().toISOString(),
    };
    saveProfile(this.profile);
    this.newSinceLastSummary = 0;
  }

  profilePath(): string {
    return profileFilePath();
  }

  /** Reload from disk (e.g. if another process updated it) */
  reload(): void {
    this.profile = loadProfile();
  }
}

export { profileFilePath } from "./store.js";
