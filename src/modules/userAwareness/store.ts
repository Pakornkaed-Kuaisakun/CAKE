// Reads/writes the user profile from ~/.cake/user-profile.json.
// Keeps at most MAX_SIGNALS signals, evicting lowest-confidence oldest ones

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CAKE_DIR } from "../../config/constants.js";
import type { UserProfile, UserSignal, SignalCategory } from "./types.js";
const PROFILE_FILE = path.join(CAKE_DIR, "user-profile.json");
const MAX_SIGNALS = 150;

const EMPTY_PROFILE: UserProfile = {
  signals: [],
  summary: "",
  turnsObserved: 0,
  lastUpdated: new Date().toISOString(),
};

// I/O
export function loadProfile(): UserProfile {
  try {
    if (!fs.existsSync(PROFILE_FILE)) return { ...EMPTY_PROFILE };
    const raw = fs.readFileSync(PROFILE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    return {
      signals: parsed.signals ?? [],
      summary: parsed.summary ?? "",
      turnsObserved: parsed.turnsObserved ?? 0,
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
    };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function saveProfile(profile: UserProfile): void {
  if (!fs.existsSync(CAKE_DIR)) fs.mkdirSync(CAKE_DIR, { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), "utf-8");
}

export function profileFilePath(): string {
  return PROFILE_FILE;
}

// Signal management
function makeId(): string {
  return crypto.randomUUID();
}

/** Merge new signals into the profile, reinforcing duplicates. */
export function mergeSignals(
  profile: UserProfile,
  newSignals: Array<
    Omit<UserSignal, "id" | "firstSeen" | "lastSeen" | "reinforcements">
  >,
  reinforcedIds: string[],
): UserProfile {
  const now = new Date().toISOString();
  const updated = { ...profile, signals: [...profile.signals] };

  // Reinforce existing signals
  for (const id of reinforcedIds) {
    const idx = updated.signals.findIndex((s) => s.id === id);
    if (idx !== -1) {
      const s = updated.signals[idx];
      updated.signals[idx] = {
        ...s,
        reinforcements: s.reinforcements + 1,
        confidence: Math.min(1, s.confidence + 0.05),
        lastSeen: now,
      };
    }
  }

  // Add new signals, deduplicating by normalized fact
  for (const ns of newSignals) {
    const normalFact = ns.fact.toLocaleLowerCase().trim();
    const existing = updated.signals.find(
      (s) =>
        s.category === ns.category &&
        s.fact.toLocaleLowerCase().trim() === normalFact,
    );

    if (existing) {
      // Reinforce it instead
      existing.reinforcements += 1;
      existing.confidence = Math.min(1, existing.confidence + 0.05);
      existing.lastSeen = now;
    } else {
      updated.signals.push({
        ...ns,
        id: makeId(),
        reinforcements: 1,
        firstSeen: now,
        lastSeen: now,
      });
    }
  }

  // Evict if over limit: drop lowest confidence x recency score
  if (updated.signals.length > MAX_SIGNALS) {
    const nowMs = Date.now();
    updated.signals = updated.signals
      .map((s) => {
        const ageMs = nowMs - new Date(s.lastSeen).getTime();
        const ageDays = ageMs / 86_400_000;
        // Score: confidence x reinforcements / (1 + ageDays * 0.1)
        const score =
          (s.confidence * Math.log1p(s.reinforcements)) / (1 + ageDays * 0.1);
        return { s, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SIGNALS)
      .map(({ s }) => s);
  }

  updated.turnsObserved += 1;
  updated.lastUpdated = now;
  return updated;
}

/** Return signals sorted by relevance for a given query */
export function getRelevantSignals(
  profile: UserProfile,
  query: string,
  limit = 20,
): UserSignal[] {
  const lower = query.toLocaleLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 3);

  return profile.signals
    .map((s) => {
      let score = s.confidence * Math.log1p(s.reinforcements);
      // Boost signals whose fact overlaps with the query
      const factLower = s.fact.toLocaleLowerCase();
      for (const w of words) {
        if (factLower.includes(w)) score += 0.3;
      }
      return { s, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ s }) => s);
}
