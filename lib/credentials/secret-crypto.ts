import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_SECRET_BYTES = 16 * 1024;

/** Parse a base64-encoded 32-byte AES key. Never log or return this value. */
function parseKey(encodedKey: string): Buffer {
  if (typeof encodedKey !== "string" || !encodedKey.trim()) {
    throw new Error("AIVANTA_CREDENTIALS_ENCRYPTION_KEY is required.");
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== encodedKey.trim()) {
    throw new Error("Credential encryption key must be canonical base64 for exactly 32 bytes.");
  }
  return key;
}

/**
 * Encrypt a credential JSON/string using AES-256-GCM.
 * The context should bind the ciphertext to a workspace and provider, e.g. `${workspaceId}:${provider}`.
 * Envelope: version byte (1), 12-byte nonce, 16-byte auth tag, ciphertext.
 */
export function encryptCredentialSecret(secret: string, encodedKey: string, context: string): Buffer {
  if (typeof secret !== "string" || !secret.length || Buffer.byteLength(secret, "utf8") > MAX_SECRET_BYTES) {
    throw new Error("Credential secret must contain between 1 and 16384 UTF-8 bytes.");
  }
  if (typeof context !== "string" || !context.trim() || context.length > 512) {
    throw new Error("Credential encryption context is required.");
  }
  const key = parseKey(encodedKey);
  const nonce = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]);
}

/** Decrypts only with the same key and authenticated context used during encryption. */
export function decryptCredentialSecret(envelope: Uint8Array, encodedKey: string, context: string): string {
  const value = Buffer.from(envelope);
  if (value.length < 1 + IV_BYTES + TAG_BYTES + 1 || value[0] !== 1) {
    throw new Error("Unsupported or malformed credential secret envelope.");
  }
  if (typeof context !== "string" || !context.trim() || context.length > 512) {
    throw new Error("Credential encryption context is required.");
  }
  const key = parseKey(encodedKey);
  const nonce = value.subarray(1, 1 + IV_BYTES);
  const tag = value.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = value.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
