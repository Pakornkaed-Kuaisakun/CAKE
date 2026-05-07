// src/agent/history.ts
import type { Message } from "../providers/types.js";

export class ConversationHistory {
  private messages: Message[] = [];

  push(role: Message["role"], content: string): void {
    this.messages.push({ role, content });
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
