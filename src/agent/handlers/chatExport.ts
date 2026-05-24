// src/agent/handlers/chatExport.ts
//
// chat_export — compose content with AI and immediately save to a file.
//
// WHY THIS EXISTS:
//   The standard "export" tool requires the planner to inline the full file
//   content inside a JSON string value:
//     {"tool":"export","input":"export md report.md|# Full 3000-word report..."}
//   This is brittle for long content because:
//     1. Every newline must be JSON-escaped as \\n.
//     2. The planner response is capped at maxTokens (4000), so long reports
//        get cut off mid-sentence.
//     3. Thinking models emit <think> blocks that eat into that token budget.
//
//   chat_export solves this by letting the planner specify ONLY a short prompt
//   (e.g. "Write a comprehensive report on the Ukraine-Russia war") and having
//   the handler itself call the AI to compose the full content — the content
//   never has to fit inside the planner's JSON output.
//
// USAGE (planner input format):
//   chat_export <format> <filename>|<prompt describing what to write>
//
// EXAMPLES:
//   chat_export md ukraine_war.md|Write a comprehensive report on the Ukraine-Russia war
//   chat_export txt notes.txt|Summarise the key points of quantum computing

import type { AIProvider, ChatResult } from "../../providers/types.js";
import { handleChat } from "./chat.js";
import { exportSink } from "./export.js";

export async function handleChatExport(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  // Strip leading "chat_export " verb if the executor passed it verbatim
  const withoutVerb = input.replace(/^chat_export\s+/i, "").trim();

  // Split on the FIRST "|" only — the prompt may itself contain "|"
  const pipeIdx = withoutVerb.indexOf("|");
  if (pipeIdx === -1) {
    return {
      text: "Usage: chat_export <format> <filename>|<prompt describing what to write>\n" +
            "Example: chat_export md report.md|Write a comprehensive report on TypeScript ORMs",
    };
  }

  const rawArgs = withoutVerb.slice(0, pipeIdx).trim(); // e.g. "md ukraine_war.md"
  const prompt  = withoutVerb.slice(pipeIdx + 1).trim(); // the AI composition prompt

  if (!prompt) {
    return { text: "chat_export: prompt (after \"|\") must not be empty." };
  }

  // Step 1 — Ask the AI to compose the full content.
  //   We use the full/worker model (passed as `model`) so the composed content
  //   is as thorough as possible, not constrained by the fast planner model.
  const chatResult = await handleChat(provider, prompt, model);

  if (!chatResult.text?.trim()) {
    return { text: "chat_export: AI returned empty content — file not written." };
  }

  // Step 2 — Write directly to disk via the shared exportSink.
  //   Content travels in memory — it never passes through the planner JSON,
  //   so there is no token limit and no JSON-escaping issue.
  return exportSink(chatResult.text, "chat_export", rawArgs);
}
