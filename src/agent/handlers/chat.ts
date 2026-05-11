import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";

/**
 * handleChat handles general conversation.
 * In a pipeline context, it receives the piped data via "__pipe__".
 */
export async function handleChat(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  // If it's a pipeline, the input will have __pipe__ context.
  // We just pass the whole thing to the LLM.
  const result = await provider.chat([{ role: "user", content: input }], {
    model: model,
  });

  return {
    text: result.text,
    usage: result.usage,
  };
}
