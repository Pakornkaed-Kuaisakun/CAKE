import type { ChatResult } from "../../providers/types.js";

// Helper: wrap a plain string into a ChatResult with no usage
export function text(t: string): ChatResult {
  return { text: t };
}
