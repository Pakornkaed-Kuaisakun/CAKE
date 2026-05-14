import type { AIProvider } from "../providers/types.js";
import { getFastModel } from "../providers/utils.js";

export async function aiIntentRouter(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<string> {
  const fastModel = model || getFastModel(provider.name);

  const prompt = `
    You are an intent classifier for a CLI assistant.

    Classify the user input into ONE of these intents:
    - chat (General conversation, greetings, AI's capabilities, general knowledge)
    - email (Fetching/summarizing emails)
    - email_send (Sending a new email)
    - news
    - calendar_list
    - calendar_create
    - calendar_remove
    - todo_list
    - todo_add
    - todo_remove
    - todo_remove_all
    - plan
    - file_list
    - directory_tree
    - document_read
    - document_summarize
    - document_ask (ONLY if the user mentions asking a specific file like .pdf, .docx, .txt)
    - file_read
    - file_summarize
    - file_compose
    - search
    - memory_index
    - cron_list
    - cron_schedule
    - cron_remove
    - notify
    - test_notify
    - finance
    - weather
    - export
    - bash (Running a shell/terminal command, e.g. "run ls", "bash echo hi", "$ pwd")
    - autonomous (Running a multi-step autonomous agent to accomplish a goal,
                e.g. "auto research X and save report", "agent do X")

    GUIDELINES:
    1. If the user is just saying hello, asking who you are, or asking about your models/settings, use "chat".
    2. Do NOT use "document_ask" unless there is a clear filename with extension in the prompt.
    3. If unsure, default to "chat".

    ONLY return the intent name. No explanation.


    User input: "${input}"
    `;

  const result = await provider.chat([{ role: "user", content: prompt }], {
    model: fastModel,
  });
  return result.text.trim().toLowerCase();
}
