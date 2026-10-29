import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function keyBytes(): Buffer {
  const encoded = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
  if (!encoded) throw new Error("CREDENTIALS_ENCRYPTION_KEY_MISSING");
  let key: Buffer;
  try { key = Buffer.from(encoded, "base64"); } catch { throw new Error("CREDENTIALS_ENCRYPTION_KEY_INVALID"); }
  if (key.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY_INVALID");
  return key;
}

export function encryptCredentials(value: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptCredentials(envelope: string): Record<string, string> {
  const [version, ivText, tagText, ciphertextText, extra] = envelope.split(".");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error("CREDENTIALS_CIPHERTEXT_INVALID");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, keyBytes(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.values(parsed).some((item) => typeof item !== "string")) {
      throw new Error("CREDENTIALS_PAYLOAD_INVALID");
    }
    return parsed as Record<string, string>;
  } catch {
    throw new Error("CREDENTIALS_DECRYPTION_FAILED");
  }
}
