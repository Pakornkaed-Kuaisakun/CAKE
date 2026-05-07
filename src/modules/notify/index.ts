import notifier from "node-notifier";
import path from "path";

export interface NotificationOptions {
  title?: string;
  message: string;
  icon?: string;
  sound?: boolean;
  wait?: boolean;
}

export function notify(options: NotificationOptions) {
  notifier.notify({
    title: options.title || "🍰 CAKE Notification",
    message: options.message,
    appID: "com.cake.ai", // เพิ่มตัวนี้เพื่อแก้ปัญหาบน Windows
    sound: options.sound ?? true,
    wait: options.wait ?? false,
  });

}

/**
 * Special handler for AI-driven notifications
 */
export async function sendNotification(text: string) {
  notify({
    message: text
  });
}
