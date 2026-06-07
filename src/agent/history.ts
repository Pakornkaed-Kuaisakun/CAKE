// src/agent/history.ts — redesigned

import { EpisodeStore } from "../modules/memory/episodes.js";
import type { AIProvider } from "../providers/types.js";
import { runConcurrent } from "../shared/utils/utils.js";

export interface HistoryMessage {
  role: "user" | "assistant" | "system";
  /** What gets sent to the LLM (compressed for tool outputs) */
  content: string;
  /** Original full content for display purposes */
  displayContent?: string;
  /** True when this message was summarized from a longer original */
  isSummary?: boolean;
}

// ── Concurrency limiter ───────────────────────────────────────────────────────
//
// Runs `tasks` with at most `limit` in flight at any time.
// Preserves input order in the returned results array.
//
// WHY THIS EXISTS:
//   compressHistory() previously used Promise.all() across every message that
//   needed compression. With a long history (e.g. 14 messages all over 300
//   chars) this fires 14 simultaneous LLM calls, which:
//     1. Saturates provider rate limits and triggers 429s / queuing.
//     2. Burns tokens on low-value system messages being re-summarized.
//     3. Creates unpredictable latency spikes on the calling path.
//
//   Capping concurrency to 3 keeps throughput reasonable while staying well
//   under typical provider rate limits (even free tiers allow ~5 RPM bursts).

// ── ConversationHistory ───────────────────────────────────────────────────────

export class ConversationHistory {
  private messages: HistoryMessage[] = [];
  private readonly maxMessages = 15;
  private readonly softTokenBudget = 3000;
  private readonly summarizeThreshold = 600;
  private readonly summarizeConcurrency = 3;

  push(
    role: HistoryMessage["role"],
    content: string,
    displayContent?: string,
  ): void {
    this.messages.push({
      role,
      content,
      displayContent: displayContent ?? content,
    });

    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }

    try {
      const store = new EpisodeStore();
      const active = store.getActiveEpisode();
      if (active) {
        store.appendMessage(active.id, { role, content, displayContent });
      }
    } catch {
      // non-fatal — do not interrupt agent execution
    }
  }

  getAll(): import("../providers/types.js").Message[] {
    return this.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  getAllForDisplay(): HistoryMessage[] {
    return [...this.messages];
  }

  /**
   * Compress older messages using LLM summarization, with concurrency limiting.
   *
   * Summarization produces a semantically faithful condensed version of each
   * message so the model retains accurate context when the user refers back to
   * earlier turns — unlike hard truncation, which silently discards the tail
   * and causes hallucinations or context inconsistency.
   *
   * Both `content` (sent to LLM) and `displayContent` (shown in UI) are set
   * to the summary so the user knows the model is working from a condensed
   * version rather than the full original.
   *
   * BUG FIX: Previously used Promise.all() which fired all summarization calls
   * in parallel — with a long history this creates a burst of simultaneous LLM
   * requests that can exhaust rate limits and cause unpredictable latency.
   * Now uses runConcurrent() with a configurable concurrency cap (default 3).
   *
   * Falls back to hard truncation if an individual provider call fails.
   */
  async compressHistory(provider: AIProvider): Promise<void> {
    const totalChars = this.messages.reduce(
      (sum, m) => sum + m.content.length,
      0,
    );
    const estimatedTokens = totalChars / 4;

    if (estimatedTokens <= this.softTokenBudget) return;

    const keepFull = 6;
    const toCompress = this.messages.slice(0, -keepFull);
    const keepRecent = this.messages.slice(-keepFull);

    // Build task thunks (not started yet) so runConcurrent controls launch timing
    const tasks = toCompress.map(
      (m) => () => this.summarizeMessage(m, provider),
    );

    const compressed = await runConcurrent(tasks, this.summarizeConcurrency);

    this.messages = [...compressed, ...keepRecent];
  }

  private async summarizeMessage(
    m: HistoryMessage,
    provider: AIProvider,
  ): Promise<HistoryMessage> {
    // Skip short messages and already-summarized ones
    if (m.content.length <= this.summarizeThreshold || m.isSummary) {
      return m;
    }

    try {
      const result = await provider.chat(
        [
          {
            role: "user",
            content:
              `Summarize the following ${m.role} message in 1–3 concise sentences, ` +
              `preserving all key facts, decisions, code snippets, and named entities. ` +
              `Return ONLY the summary — no preamble.\n\n${m.content.slice(0, 6000)}`,
          },
        ],
        {
          // Use the fastest available model — this runs on the hot path
          maxTokens: 200,
          temperature: 0,
        },
      );

      const summary = `[Summary] ${result.text.trim()}`;

      return {
        ...m,
        content: summary,
        displayContent: summary,
        isSummary: true,
      };
    } catch {
      // Fallback: hard truncation with an honest label so both LLM and UI
      // see the same thing (no split-brain)
      const totalChars = m.content.length;
      const keptChars = this.summarizeThreshold;
      const droppedChars = totalChars - keptChars;
      const fallback =
        m.content.slice(0, this.summarizeThreshold) +
        `…[${droppedChars} chars omitted — summarization unavailable]`;
      return {
        ...m,
        content: fallback,
        displayContent: fallback,
        isSummary: true,
      };
    }
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }
}
