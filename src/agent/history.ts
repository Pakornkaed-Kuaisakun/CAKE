// src/agent/history.ts
import type { Message } from "../providers/types.js";

export class ConversationHistory {
  private messages: Message[] = [];
  private maxHistory = 20; // Keep last 20 messages (approx. 10 turns) to reduce input tokens

  push(role: Message["role"], content: string): void {
    this.messages.push({ role, content });
    if (this.messages.length > this.maxHistory) {
      this.messages = this.messages.slice(-this.maxHistory);
    }
  }

  getAll(): Message[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }
}
