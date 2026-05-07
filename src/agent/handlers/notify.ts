import type { AIProvider, ChatResult } from "../../providers/types.js";
import { notify } from "../../modules/notify/index.js";
import { text } from "../utils/text.js";

export async function handleNotify(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  // Extract message from input (e.g., "notify take a pill" -> "take a pill")
  const message = input.replace(/^(notify|remind|alert)\s+/i, "").trim();
  
  if (!message) return text("Please specify what to notify.");

  notify({
    title: "🍰 CAKE Reminder",
    message: message,
    sound: true,
    wait: false
  });

  return text(`Bell Notification sent: "${message}"`);
}

export async function handleTestNotify(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  notify({
    title: "🍰 CAKE Test Notification",
    message: "This is a test notification from CAKE! It works! 🎉",
    sound: true
  });

  return text("🔔 Test notification sent! Check your desktop alerts.");
}

