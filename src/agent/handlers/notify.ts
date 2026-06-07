import type { AIProvider, ChatResult } from "../../providers/types.js";
import { notify } from "../../modules/notify/index.js";
import { stripVerb, formatChatResult } from "../../shared/utils/utils.js";

export async function handleNotify(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  // Extract message from input (e.g., "notify take a pill" -> "take a pill")
  const message = stripVerb(input, ["notify", "remind", "alert"]);

  if (!message) return formatChatResult("Please specify what to notify.");

  notify({
    title: "🍰 CAKE Reminder",
    message: message,
    sound: true,
    wait: false,
  });

  return formatChatResult(`Bell Notification sent: "${message}"`);
}

export async function handleTestNotify(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  notify({
    title: "🍰 CAKE Test Notification",
    message: "This is a test notification from CAKE! It works! 🎉",
    sound: true,
  });

  return formatChatResult(
    "🔔 Test notification sent! Check your desktop alerts.",
  );
}
