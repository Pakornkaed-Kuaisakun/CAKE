import type { AIProvider, ChatResult } from "../../../providers/types.js";

export async function summarizeChunk(
  provider: AIProvider,
  chunk: string,
  model?: string,
): Promise<ChatResult> {
  return provider.chat(
    [
      {
        role: "user",
        content: `
            Summarize this document chunk.

            Use bullet points.
            Keep important details.

            ${chunk}
            `,
      },
    ],
    { model },
  );
}
