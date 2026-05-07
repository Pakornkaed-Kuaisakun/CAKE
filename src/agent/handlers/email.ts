import type { AIProvider, ChatResult } from "../../providers/types.js";
import { fetchEmails, summarizeAll } from "../../modules/email/index.js";
import { text } from "../utils/text.js";

export async function handleEmail(
  provider: AIProvider,
  _input: string,
  model?: string,
): Promise<ChatResult> {
  const raw = await fetchEmails(5);
  const summaries = await summarizeAll(provider, raw, model);
  const out = summaries
    .map(
      (e) =>
        `  • ${e.subject}\n    From: ${e.from}\n    Date: ${new Date(e.date).toLocaleString()}\n      Summary: ${e.summary}\n    `,
    )
    .join("\n\n");
  return text(`[EMAIL] Emails:\n${out}`);
}
