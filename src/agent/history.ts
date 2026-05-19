// src/agent/history.ts — redesigned

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  /** What gets sent to the LLM (compressed for tool outputs) */
  content: string;
  /** Original full content for display purposes */
  displayContent?: string;
}

export class ConversationHistory {
  private messages: HistoryMessage[] = [];
  private readonly maxMessages = 20;
  /** Soft token budget — trigger compression if exceeded */
  private readonly softTokenBudget = 4000; // ~16,000 chars

  push(role: HistoryMessage['role'], content: string, displayContent?: string): void {
    this.messages.push({
      role,
      content,
      displayContent: displayContent ?? content,
    });

    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }

    // If history is getting large, compress older entries
    this.maybeTrimHistory();
  }

  getAll(): import('../providers/types.js').Message[] {
    return this.messages.map(m => ({ role: m.role, content: m.content }));
  }

  getAllForDisplay(): HistoryMessage[] {
    return [...this.messages];
  }

  private maybeTrimHistory(): void {
    const totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = totalChars / 4;

    if (estimatedTokens <= this.softTokenBudget) return;

    // Compress messages older than the last 6 (3 turns)
    const keepFull = 6;
    const toCompress = this.messages.slice(0, -keepFull);
    const keepRecent = this.messages.slice(-keepFull);

    const compressed = toCompress.map(m => ({
      ...m,
      // Truncate long messages aggressively
      content: m.content.length > 300
        ? m.content.slice(0, 300) + '…[truncated]'
        : m.content,
    }));

    this.messages = [...compressed, ...keepRecent];
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }
}
