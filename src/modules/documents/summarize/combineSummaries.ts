import type { AIProvider, ChatResult } from "../../../providers/types.js";

export async function combineSummaries(
  provider: AIProvider,
  summaries: string[],
  model?: string,
): Promise<ChatResult> {
  return provider.chat(
    [
      {
        role: "user",
        content: `
        Combine these summaries into one final summary.

        ${summaries.join("\n")}
        `,
      },
    ],
    { model },
  );
}
