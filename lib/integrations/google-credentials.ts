import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type GoogleCredentials = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expiry_date?: number;
};

function encryptionKey(): Buffer {
  const configured = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
  if (!configured) throw new Error("Google token encryption is not configured.");
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new Error("Google credential encryption key must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function encryptGoogleCredentials(credentials: GoogleCredentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptGoogleCredentials(value: string): GoogleCredentials {
  const [version, ivValue, tagValue, encryptedValue, extra] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue || extra) {
    throw new Error("Stored Google credentials have an unsupported format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed: unknown = JSON.parse(decrypted);
  if (!parsed || typeof parsed !== "object" || !("access_token" in parsed)
      || typeof parsed.access_token !== "string") {
    throw new Error("Stored Google credentials are invalid.");
  }
  return parsed as GoogleCredentials;
}
