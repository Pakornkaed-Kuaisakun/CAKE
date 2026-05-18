// src/modules/locker/store.ts
//
// Persists encrypted entries to ~/.cake/locker.json.
// The file contains ONLY ciphertext, IVs and salts — never plaintext or
// the password. Even with full disk access an attacker needs the password.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CAKE_DIR } from "../../config/constants.js";
import type { LockerStore, LockerEntry, LockerListResult } from "./types.js";
import { PBKDF2_ITERATIONS } from "./crypto.js";

const LOCKER_FILE = path.join(CAKE_DIR, "locker.json");

const EMPTY_STORE: LockerStore = {
  pbkdf2Iterations: PBKDF2_ITERATIONS,
  entries: [],
};

// ── I/O ───────────────────────────────────────────────────────────────────────

export function lockerFilePath(): string {
  return LOCKER_FILE;
}

function loadStore(): LockerStore {
  try {
    if (!fs.existsSync(LOCKER_FILE)) return { ...EMPTY_STORE, entries: [] };
    const raw = fs.readFileSync(LOCKER_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LockerStore>;
    return {
      pbkdf2Iterations: parsed.pbkdf2Iterations ?? PBKDF2_ITERATIONS,
      entries: parsed.entries ?? [],
    };
  } catch {
    return { ...EMPTY_STORE, entries: [] };
  }
}

function saveStore(store: LockerStore): void {
  if (!fs.existsSync(CAKE_DIR)) fs.mkdirSync(CAKE_DIR, { recursive: true });
  fs.writeFileSync(LOCKER_FILE, JSON.stringify(store, null, 2), "utf-8");
  // Restrict file permissions on POSIX systems (owner read/write only)
  try {
    fs.chmodSync(LOCKER_FILE, 0o600);
  } catch {
    // Windows doesn't support chmod — skip silently
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function addEntry(
  label: string,
  encryptedValue: string,
  iv: string,
  salt: string,
  category?: string,
): LockerEntry {
  const store = loadStore();
  const now = new Date().toISOString();
  const entry: LockerEntry = {
    id: crypto.randomUUID(),
    label,
    encryptedValue,
    iv,
    salt,
    category,
    createdAt: now,
    updatedAt: now,
  };
  store.entries.push(entry);
  saveStore(store);
  return entry;
}

export function getEntry(id: string): LockerEntry | null {
  const store = loadStore();
  return store.entries.find((e) => e.id === id) ?? null;
}

export function listEntries(): LockerListResult[] {
  const store = loadStore();
  return store.entries.map(({ id, label, category, createdAt, updatedAt }) => ({
    id,
    label,
    category,
    createdAt,
    updatedAt,
  }));
}

export function deleteEntry(id: string): boolean {
  const store = loadStore();
  const before = store.entries.length;
  store.entries = store.entries.filter((e) => e.id !== id);
  if (store.entries.length === before) return false;
  saveStore(store);
  return true;
}

export function updateEntry(
  id: string,
  encryptedValue: string,
  iv: string,
  salt: string,
  label?: string,
  category?: string,
): boolean {
  const store = loadStore();
  const idx = store.entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;

  store.entries[idx] = {
    ...store.entries[idx],
    encryptedValue,
    iv,
    salt,
    label: label ?? store.entries[idx].label,
    category: category ?? store.entries[idx].category,
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
  return true;
}

export function entryExists(id: string): boolean {
  return loadStore().entries.some((e) => e.id === id);
}

export function clearAll(): number {
  const store = loadStore();
  const count = store.entries.length;
  store.entries = [];
  saveStore(store);
  return count;
}
