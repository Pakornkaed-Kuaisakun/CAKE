// src/modules/userAwareness/index.ts
//
// FIX: getContextString(query) now actually uses the query parameter.
//
// BEFORE: returned the same static cachedProfileLayer for every query,
//   built from profile.summary (a pre-generated paragraph). Cache only
//   invalidated when signal COUNT changed, not when query changed.
//   Result: user asking about finance and coding got identical context.
//
// AFTER: calls getRelevantSignals(profile, query, 5) which scores signals
//   by keyword overlap + confidence + reinforcement count, then builds a
//   concise context string from the top matches. Falls back to the static
//   summary when no signals are relevant or profile is empty.
//
// SECONDARY FIX: the static summary cache (cachedProfileLayer) is kept
//   for getSummary() callers, but getContextString() no longer uses it —
//   it always computes a fresh per-query result (cheap: pure in-memory scoring,
//   no LLM call, no I/O).

import type { AIProvider } from "../../providers/types.js";
import {
  saveProfile,
  mergeSignals,
  getRelevantSignals,
  profileFilePath,
  loadProfile,
} from "./store.js";
import { extractSignals, generateProfileSummary } from "./extractor.js";
import type { UserProfile, UserSignal } from "./types.js";
import { buildProfileLayer } from "../../agent/promptAssembler.js";

export type { UserProfile, UserSignal, SignalCategory } from "./types.js";

// Regenerate summary every N new signals
const SUMMARY_REGEN_INTERVAL = 5;

// Maximum signals to include in per-query context injection
const MAX_CONTEXT_SIGNALS = 5;

// Minimum confidence threshold — low-confidence signals are noise
const MIN_SIGNAL_CONFIDENCE = 0.4;

export class UserAwarenessManager {
  private provider: AIProvider;
  private model: string | undefined;
  private profile: UserProfile;
  private newSinceLastSummary = 0;
  private readonly MIN_MESSAGE_LENGTH = 12;

  // Cache for the static summary layer (used by getSummary())
  // Invalidated when signal count changes
  private cachedProfileLayer = "";
  private lastSignalCount = 0;

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

  observe(userMessage: string, assistantResponse: string): void {
    if (userMessage.length < this.MIN_MESSAGE_LENGTH) return;
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
      // Always silent
    }
  }

  // ── Context injection ──────────────────────────────────────────────────────

  /**
   * FIX: Returns a query-relevant context string built from the signals
   * that best match the current user input.
   *
   * BEFORE: always returned cachedProfileLayer (same string for every query).
   * AFTER:  scores signals by keyword overlap with query + confidence +
   *         reinforcement count, builds context from top matches.
   *
   * Falls back to the static summary layer when:
   *   - Profile has no signals yet
   *   - No signals meet the minimum confidence threshold
   *   - All relevant signals score below the relevance threshold
   *
   * Cost: pure in-memory computation, no LLM/IO call.
   */
  getContextString(query: string): string {
    if (this.profile.signals.length === 0) {
      return this._getStaticProfileLayer();
    }

    // Get signals scored and ranked by relevance to this specific query
    const relevant = getRelevantSignals(
      this.profile,
      query,
      MAX_CONTEXT_SIGNALS,
    ).filter((s) => s.confidence >= MIN_SIGNAL_CONFIDENCE);

    if (relevant.length === 0) {
      // No relevant signals → fall back to generic summary
      return this._getStaticProfileLayer();
    }

    // Build a concise context string from relevant signals
    const contextText = this._buildContextFromSignals(relevant, query);
    return buildProfileLayer(contextText);
  }

  /**
   * Build a readable context paragraph from a ranked list of signals.
   * Groups by category for readability, keeps it concise.
   */
  private _buildContextFromSignals(
    signals: UserSignal[],
    query: string,
  ): string {
    // Group signals by category
    const grouped = new Map<string, string[]>();
    for (const signal of signals) {
      const existing = grouped.get(signal.category) ?? [];
      existing.push(signal.fact);
      grouped.set(signal.category, existing);
    }

    const parts: string[] = [];

    // Priority order: skill and goal first (most actionable for the LLM)
    const categoryOrder = [
      "skill",
      "goal",
      "preference",
      "context",
      "lifestyle",
      "habit",
      "personality",
      "prompt_style",
    ];

    for (const cat of categoryOrder) {
      const facts = grouped.get(cat);
      if (!facts || facts.length === 0) continue;
      // One line per category, comma-separated facts
      parts.push(facts.join("; "));
    }

    // Include any categories not in the priority list
    for (const [cat, facts] of grouped) {
      if (!categoryOrder.includes(cat)) {
        parts.push(facts.join("; "));
      }
    }

    return parts.join(". ");
  }

  /**
   * Returns the static (non-query-specific) profile layer.
   * Built from profile.summary and cached until signal count changes.
   * Used as fallback when no query-relevant signals are found.
   */
  private _getStaticProfileLayer(): string {
    const currentSignalCount = this.profile.signals.length;
    if (currentSignalCount !== this.lastSignalCount) {
      this.cachedProfileLayer = buildProfileLayer(this.profile.summary);
      this.lastSignalCount = currentSignalCount;
    }
    return this.cachedProfileLayer;
  }

  /**
   * Returns the full profile summary paragraph (for getSummary() callers).
   * This is the static summary — not query-specific.
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
    this.cachedProfileLayer = "";
    this.lastSignalCount = 0;
  }

  profilePath(): string {
    return profileFilePath();
  }

  reload(): void {
    this.profile = loadProfile();
    this.cachedProfileLayer = "";
    this.lastSignalCount = 0;
  }
}

export { profileFilePath } from "./store.js";
