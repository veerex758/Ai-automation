import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhookSignature } from "../lib/webhooks/verify-signature";

function sign(body: string, secret: string, timestamp: number, signedMetadata?: string) {
  const prefix = timestamp + "." + (signedMetadata === undefined ? "" : signedMetadata + ".");
  return "t=" + timestamp + ",v1=" + createHmac("sha256", secret).update(prefix + body).digest("hex");
}

test("verifies a signature over the exact raw body", () => {
  const body = '{"event":"signup","id":"evt_1"}';
  const signatureHeader = sign(body, "test-secret", 1_800_000_000);
  assert.deepEqual(verifyWebhookSignature({
    rawBody: body, signatureHeader, secret: "test-secret", nowSeconds: 1_800_000_010,
  }), { ok: true, timestamp: 1_800_000_000 });
});

test("rejects modified bodies and incorrect secrets", () => {
  const body = '{"event":"signup"}';
  const signatureHeader = sign(body, "test-secret", 1_800_000_000);
  assert.deepEqual(verifyWebhookSignature({
    rawBody: body + " ", signatureHeader, secret: "test-secret", nowSeconds: 1_800_000_000,
  }), { ok: false, reason: "signature_mismatch" });
  assert.deepEqual(verifyWebhookSignature({
    rawBody: body, signatureHeader, secret: "other-secret", nowSeconds: 1_800_000_000,
  }), { ok: false, reason: "signature_mismatch" });
});

test("rejects stale timestamps and malformed signature headers", () => {
  assert.deepEqual(verifyWebhookSignature({
    rawBody: "{}", signatureHeader: sign("{}", "secret", 1_800_000_000),
    secret: "secret", nowSeconds: 1_800_000_301,
  }), { ok: false, reason: "timestamp_out_of_range" });
  assert.deepEqual(verifyWebhookSignature({
    rawBody: "{}", signatureHeader: "v1=not-a-signature", secret: "secret", nowSeconds: 1_800_000_000,
  }), { ok: false, reason: "malformed_signature" });
});

test("rejects missing secret or signature without throwing", () => {
  assert.deepEqual(verifyWebhookSignature({ rawBody: "{}", signatureHeader: null, secret: undefined }), {
    ok: false, reason: "missing_secret",
  });
  assert.deepEqual(verifyWebhookSignature({ rawBody: "{}", signatureHeader: null, secret: "secret" }), {
    ok: false, reason: "missing_signature",
  });
});

test("verifies exact non-UTF8 request bytes without decoding and re-encoding", () => {
  const rawBody = Buffer.from([0xff, 0x00, 0x80, 0x7b, 0x7d]);
  const timestamp = 1_800_000_000;
  const secret = "test-secret";
  const digest = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(timestamp + "."), rawBody]))
    .digest("hex");
  assert.deepEqual(verifyWebhookSignature({
    rawBody, signatureHeader: "t=" + timestamp + ",v1=" + digest,
    secret, nowSeconds: timestamp,
  }), { ok: true, timestamp });
});

test("rejects ambiguous signature headers with multiple timestamps", () => {
  const body = "{}";
  const timestamp = 1_800_000_000;
  const signatureHeader = sign(body, "test-secret", timestamp) + ",t=" + timestamp;
  assert.deepEqual(verifyWebhookSignature({
    rawBody: body, signatureHeader, secret: "test-secret", nowSeconds: timestamp,
  }), { ok: false, reason: "malformed_signature" });
});

test("binds event ID and event type to the webhook signature", () => {
  const body = '{"orderId":"ord_1"}';
  const timestamp = 1_800_000_000;
  const metadata = JSON.stringify(["evt_1", "order.created"]);
  const signatureHeader = sign(body, "test-secret", timestamp, metadata);

  assert.deepEqual(verifyWebhookSignature({
    rawBody: body, signedMetadata: metadata, signatureHeader, secret: "test-secret", nowSeconds: timestamp,
  }), { ok: true, timestamp });

  assert.deepEqual(verifyWebhookSignature({
    rawBody: body, signedMetadata: JSON.stringify(["evt_2", "order.created"]),
    signatureHeader, secret: "test-secret", nowSeconds: timestamp,
  }), { ok: false, reason: "signature_mismatch" });

  assert.deepEqual(verifyWebhookSignature({
    rawBody: body, signedMetadata: JSON.stringify(["evt_1", "order.cancelled"]),
    signatureHeader, secret: "test-secret", nowSeconds: timestamp,
  }), { ok: false, reason: "signature_mismatch" });
});
