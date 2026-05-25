// src/agent/tokenBudgetTracker.ts

export class TokenBudgetTracker {
  private sessionTokens = 0;
  private savedTokens = 0;
  private readonly hourlyLimit: number;
  private hourStart = Date.now();

  constructor(hourlyLimit = 500_000) {
    this.hourlyLimit = hourlyLimit;
  }

  record(tokens: number): void {
    const now = Date.now();
    if (now - this.hourStart > 3_600_000) {
      this.sessionTokens = 0;
      this.hourStart = now;
    }
    this.sessionTokens += tokens;
  }

  isNearLimit(): boolean {
    return this.sessionTokens > this.hourlyLimit * 0.9;
  }

  recordSavings(tokens: number): void {
    this.savedTokens += Math.max(0, Math.floor(tokens));
  }

  getReport(): {
    sessionTokens: number;
    remainingTokens: number;
    savedTokens: number;
    hourlyLimit: number;
  } {
    return {
      sessionTokens: this.sessionTokens,
      remainingTokens: this.remainingTokens(),
      savedTokens: this.savedTokens,
      hourlyLimit: this.hourlyLimit,
    };
  }

  reportSummary(): string {
    const report = this.getReport();
    return `Token usage ${report.sessionTokens}/${report.hourlyLimit}, remaining ${report.remainingTokens}, estimated savings ${report.savedTokens}.`;
  }

  remainingTokens(): number {
    return Math.max(0, this.hourlyLimit - this.sessionTokens);
  }
}
