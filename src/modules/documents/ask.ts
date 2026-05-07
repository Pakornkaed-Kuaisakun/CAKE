import { AIProvider, ChatResult } from "../../providers/types.js";

export async function askDocument(
  provider: AIProvider,
  context: string,
  question: string,
  model?: string,
): Promise<ChatResult> {
  const response = await provider.chat(
    [
      {
        role: "system",
        content: `
          You are an AI document assistant.

          Answer ONLY using the provided document context.

          If the answer is not found in the document,
          say:
          "I could not find that information in the document."
          `,
      },
      {
        role: "user",
        content: `
          DOCUMENT CONTEXT:
          ${context}

          QUESTION:
          ${question}
          `,
      },
    ],
    { model },
  );

  return response;
}
