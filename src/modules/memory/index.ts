// src/modules/memory/index.ts
import { TieredMemoryManager } from "./tieredMemory.js";

// ── One-time warning: emitted at most once per process ───────────────────────
let embedWarningEmitted = false;

/** Returns true (and marks as emitted) the first time no-embed is detected. */
export function consumeEmbedWarning(): boolean {
  if (embedWarningEmitted) return false;
  embedWarningEmitted = true;
  return true;
}

export class MemoryManager extends TieredMemoryManager {
  constructor(
    provider: import("../../providers/types.js").AIProvider,
    storageDir?: string,
  ) {
    super(provider, storageDir);
  }

  override async remember(
    text: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    if (!metadata.source && !(this as any).provider.embed) {
      consumeEmbedWarning();
    }
    await super.remember(text, metadata);
  }
}

export * from "./types.js";
export { TieredMemoryManager, WorkingMemory } from "./tieredMemory.js";
