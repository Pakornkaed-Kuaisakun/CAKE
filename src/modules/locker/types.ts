// src/modules/locker/types.ts

export interface LockerEntry {
  id: string;
  label: string;
  /** Encrypted value (hex-encoded ciphertext) */
  encryptedValue: string;
  /** Random IV used for this entry (hex) */
  iv: string;
  /** Random salt used to derive key from password (hex) */
  salt: string;
  /** Category tag (optional) */
  category?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LockerStore {
  /** PBKDF2 iterations used — stored so future readers know the cost */
  pbkdf2Iterations: number;
  entries: LockerEntry[];
}

export interface LockerAddOptions {
  label: string;
  value: string;
  password: string;
  category?: string;
}

export interface LockerGetOptions {
  id: string;
  password: string;
}

export interface LockerListResult {
  id: string;
  label: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
}
