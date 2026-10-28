import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookVerificationResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing_secret" | "missing_signature" | "malformed_signature" | "timestamp_out_of_range" | "signature_mismatch" };

const DEFAULT_TOLERANCE_SECONDS = 300;
const MAX_SIGNATURE_HEADER_LENGTH = 2048;

/**
 * Verify an HMAC-SHA256 signature over the exact raw request body.
 * Header format: t=<unix-seconds>,v1=<lowercase-hex-digest>
 * The caller must read and size-limit the raw body before invoking this helper.
 */
export function verifyWebhookSignature(args: {
  rawBody: string | Uint8Array;
  signatureHeader: string | null;
  secret: string | undefined;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): WebhookVerificationResult {
  const { rawBody, signatureHeader, secret } = args;
  if (!secret || !secret.trim()) return { ok: false, reason: "missing_secret" };
  if (!signatureHeader) return { ok: false, reason: "missing_signature" };
  if (signatureHeader.length > MAX_SIGNATURE_HEADER_LENGTH) return { ok: false, reason: "malformed_signature" };

  const timestampMatch = /(?:^|,)\s*t=(\d{1,12})(?:,|$)/.exec(signatureHeader);
  const signatures = [...signatureHeader.matchAll(/(?:^|,)\s*v1=([a-fA-F0-9]{64})(?=,|$)/g)].map((match) => match[1]);
  if (!timestampMatch || signatures.length === 0) return { ok: false, reason: "malformed_signature" };

  const timestamp = Number(timestampMatch[1]);
  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const toleranceSeconds = args.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(nowSeconds) || !Number.isFinite(toleranceSeconds) || toleranceSeconds < 0 ||
      Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_range" };
  }

  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  const expected = createHmac("sha256", secret).update(timestampMatch[1] + "." + body, "utf8").digest();
  const matches = signatures.some((signature) => {
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
  return matches ? { ok: true, timestamp } : { ok: false, reason: "signature_mismatch" };
}
