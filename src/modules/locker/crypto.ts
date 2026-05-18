// src/modules/locker/crypto.ts
//
// Encryption: AES-256-GCM (authenticated encryption — detects tampering)
// Key derivation: PBKDF2-SHA256, 210,000 iterations (OWASP 2023 recommendation)
// Each entry gets its own random salt + IV so identical passwords + values
// produce different ciphertexts. No master password is stored anywhere.

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32; // 256 bits
const IV_LEN = 12; // 96 bits — recommended for GCM
const TAG_LEN = 16; // 128 bits — GCM auth tag
const SALT_LEN = 32; // 256 bits
export const PBKDF2_ITERATIONS = 210_000;
const DIGEST = "sha256";

// ── Key derivation ────────────────────────────────────────────────────────────

export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, DIGEST);
}

// ── Encrypt ───────────────────────────────────────────────────────────────────

export interface EncryptResult {
  ciphertext: string; // hex: ciphertext + auth tag
  iv: string; // hex
  salt: string; // hex
}

export function encrypt(plaintext: string, password: string): EncryptResult {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // 16-byte GCM auth tag

  // Store ciphertext + tag together — we'll split on decrypt
  const payload = Buffer.concat([encrypted, tag]);

  return {
    ciphertext: payload.toString("hex"),
    iv: iv.toString("hex"),
    salt: salt.toString("hex"),
  };
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

/**
 * Returns the decrypted string.
 * Throws with a generic "Wrong password or corrupted data" message so
 * callers cannot distinguish a wrong password from tampered ciphertext.
 */
export function decrypt(
  ciphertextHex: string,
  ivHex: string,
  saltHex: string,
  password: string,
): string {
  try {
    const payload = Buffer.from(ciphertextHex, "hex");
    const iv = Buffer.from(ivHex, "hex");
    const salt = Buffer.from(saltHex, "hex");
    const key = deriveKey(password, salt);

    // Split payload: last TAG_LEN bytes = auth tag
    const encrypted = payload.subarray(0, payload.length - TAG_LEN);
    const tag = payload.subarray(payload.length - TAG_LEN);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch {
    throw new Error("Wrong password or corrupted data.");
  }
}
