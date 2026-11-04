import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_BYTES = 32;

function getKey(): Buffer {
  const encoded = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
  if (!encoded) throw new Error("AIVANTA_CREDENTIALS_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) throw new Error("AIVANTA_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

/** Encrypt workspace provider credentials with AES-256-GCM before they reach Supabase. */
export function encryptWorkspaceCredentials(credentials: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Decrypt only in server-side execution paths; callers must never return this value to a client. */
export function decryptWorkspaceCredentials(value: string): Record<string, string> {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue || extra) throw new Error("Stored workspace credentials have an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Stored workspace credentials are invalid.");
  for (const [key, secret] of Object.entries(parsed)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || typeof secret !== "string" || !secret) throw new Error("Stored workspace credentials are invalid.");
  }
  return parsed as Record<string, string>;
}
