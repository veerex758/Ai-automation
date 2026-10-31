import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function parseKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("Webhook encryption key must be a base64-encoded 32-byte key.");
  }
  return key;
}

/** AES-256-GCM encryption for webhook signing secrets at rest. */
export function encryptWebhookSecret(secret: string, encodedKey: string): Buffer {
  if (!secret || secret.length > 4096) {
    throw new Error("Webhook signing secret must contain between 1 and 4096 characters.");
  }
  const key = parseKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Versioned envelope: byte 0 is format version 1, then IV, auth tag, ciphertext.
  return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]);
}

export function decryptWebhookSecret(envelope: Uint8Array, encodedKey: string): string {
  const value = Buffer.from(envelope);
  if (value.length < 1 + IV_BYTES + TAG_BYTES + 1 || value[0] !== 1) {
    throw new Error("Unsupported or malformed webhook secret envelope.");
  }
  const key = parseKey(encodedKey);
  const iv = value.subarray(1, 1 + IV_BYTES);
  const tag = value.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = value.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
