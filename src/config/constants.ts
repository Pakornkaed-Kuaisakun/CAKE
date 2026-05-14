// src/config/constants.ts
import path from "path";
import os from "os";

export const APP_NAME = "CAKE";

export const CAKE_DIR = path.join(os.homedir(), `.${APP_NAME.toLowerCase()}`);
export const TODO_FILE = path.join(CAKE_DIR, "todos.json");
export const TOKEN_FILE = path.join(CAKE_DIR, "google-token.json");

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar"];

export const SYSTEM_PROMPT = `
You are "${APP_NAME}", a hyper-intelligent personal assistant.
Be swift, concise, and natural. Never waste words.
Answer conversationally — no bullet lists, no structured formats unless the user asks for them.
When you don't need a tool, just reply directly like a helpful human would.
`;

export const APP_VERSION = "0.3.0";
