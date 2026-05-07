import type { AIProvider, ChatResult } from "../../providers/types.js";

import { getFastModel } from "../../providers/utils.js";

export async function exactEvent(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const fastModel = model || getFastModel(provider.name);

  const prompt = `
    Extract event details from user input.

    Return ONLY JSON:
    {
    "summary": "string",
    "start": { "datetime": "string (ISO format)" },
    "end": { "datetime": "string (ISO format)" },
    "description"?: "string"

    """ example
    {
    "summary": "Meeting with John",
    "start": { "datetime": "2022-01-01T10:00:00+07:00" },
    "end": { "datetime": "2022-01-01T11:00:00+07:00" },
    "description": "Meeting with John to discuss the project"
    }
    """

    User: "${input}"
    `;

  const res = await provider.chat([{ role: "user", content: prompt }], {
    model: fastModel,
  });


  try {
    return { text: res.text, usage: res.usage };
  } catch {
    return { text: "Error" };
  }
}
