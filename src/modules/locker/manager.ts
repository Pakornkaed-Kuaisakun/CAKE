// src/modules/locker/manager.ts
//
// High-level API used by the handler layer.
// All password handling stays inside this file; the handler only passes
// the password string in and gets a result out.

import { encrypt, decrypt } from "./crypto.js";
import {
  addEntry,
  getEntry,
  listEntries,
  deleteEntry,
  updateEntry,
  clearAll,
  lockerFilePath,
} from "./store.js";
import type { LockerListResult } from "./types.js";

export { lockerFilePath };

// ── Add ───────────────────────────────────────────────────────────────────────

export function lockerAdd(
  label: string,
  value: string,
  password: string,
  category?: string,
): string {
  const { ciphertext, iv, salt } = encrypt(value, password);
  const entry = addEntry(label, ciphertext, iv, salt, category);
  return entry.id;
}

// ── Retrieve (decrypts and returns plaintext) ──────────────────────────────────

export function lockerGet(id: string, password: string): string {
  const entry = getEntry(id);
  if (!entry) throw new Error(`Entry "${id}" not found.`);
  // decrypt() throws "Wrong password or corrupted data." on bad password
  return decrypt(entry.encryptedValue, entry.iv, entry.salt, password);
}

// ── Update value ──────────────────────────────────────────────────────────────

export function lockerUpdate(
  id: string,
  newValue: string,
  password: string,
  newLabel?: string,
  newCategory?: string,
): void {
  const entry = getEntry(id);
  if (!entry) throw new Error(`Entry "${id}" not found.`);

  // Verify old password by attempting a decrypt first (throws on wrong password)
  decrypt(entry.encryptedValue, entry.iv, entry.salt, password);

  // Re-encrypt with same password (new salt + IV for forward secrecy)
  const { ciphertext, iv, salt } = encrypt(newValue, password);
  updateEntry(id, ciphertext, iv, salt, newLabel, newCategory);
}

// ── List (no decryption, safe to show) ───────────────────────────────────────

export function lockerList(): LockerListResult[] {
  return listEntries();
}

// ── Delete ────────────────────────────────────────────────────────────────────

export function lockerDelete(id: string): boolean {
  return deleteEntry(id);
}

// ── Clear all ─────────────────────────────────────────────────────────────────

export function lockerClear(): number {
  return clearAll();
}

// ── Label/ID lookup helper ────────────────────────────────────────────────────

/**
 * Find an entry ID by partial label match (case-insensitive).
 * Returns the first match or null.
 */
export function findEntryByLabel(query: string): LockerListResult | null {
  const lower = query.toLowerCase();
  return (
    lockerList().find(
      (e) =>
        e.id === query ||
        e.id.startsWith(query) ||
        e.label.toLowerCase().includes(lower),
    ) ?? null
  );
}
