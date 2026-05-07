// src/config/preferences.ts
// Persistent user preferences stored in ~/.cake/prefs.json
// Survives restarts — loaded at startup, updated on /default or /provider --save.

import fs from "fs";
import path from "path";
import os from "os";

export interface Preferences {
  provider: string;
  model: string | null;
}

const PREFS_DIR = path.join(os.homedir(), ".cake");
const PREFS_FILE = path.join(PREFS_DIR, "prefs.json");

const DEFAULTS: Preferences = {
  provider: "claude",
  model: null,
};

/** Load preferences from disk. Returns defaults if file doesn't exist. */
export function loadPrefs(): Preferences {
  try {
    if (!fs.existsSync(PREFS_FILE)) return { ...DEFAULTS };
    const raw = fs.readFileSync(PREFS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      provider: parsed.provider ?? DEFAULTS.provider,
      model: parsed.model ?? DEFAULTS.model,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Save preferences to ~/.cake/prefs.json */
export function savePrefs(prefs: Partial<Preferences>): void {
  const current = loadPrefs();
  const next: Preferences = {
    provider: prefs.provider ?? current.provider,
    model: prefs.model !== undefined ? prefs.model : current.model,
  };
  if (!fs.existsSync(PREFS_DIR)) {
    fs.mkdirSync(PREFS_DIR, { recursive: true });
  }
  fs.writeFileSync(PREFS_FILE, JSON.stringify(next, null, 2), "utf-8");
}

/** Return the path of the prefs file (for display in messages). */
export function prefsFilePath(): string {
  return PREFS_FILE;
}
