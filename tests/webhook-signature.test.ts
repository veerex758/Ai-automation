import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhookSignature } from "../lib/webhooks/verify-signature";

function sign(body: string, secret: string, timestamp: number) {
  return "t=" + timestamp + ",v1=" + createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
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


test("binds event ID and type metadata into the signed message", () => {
  const body = '{"leadId":"lead_1"}';
  const timestamp = 1_800_000_000;
  const secret = "test-secret";
  const signedMetadata = JSON.stringify(["evt_1", "lead.created"]);
  const digest = createHmac("sha256", secret)
    .update(timestamp + "." + signedMetadata + "." + body)
    .digest("hex");
  const signatureHeader = "t=" + timestamp + ",v1=" + digest;
  assert.deepEqual(verifyWebhookSignature({
    rawBody: body, signatureHeader, secret, nowSeconds: timestamp, signedMetadata,
  }), { ok: true, timestamp });
  assert.deepEqual(verifyWebhookSignature({
    rawBody: body, signatureHeader, secret, nowSeconds: timestamp,
    signedMetadata: JSON.stringify(["evt_2", "lead.created"]),
  }), { ok: false, reason: "signature_mismatch" });
  assert.deepEqual(verifyWebhookSignature({
    rawBody: body, signatureHeader, secret, nowSeconds: timestamp,
    signedMetadata: JSON.stringify(["evt_1", "lead.updated"]),
  }), { ok: false, reason: "signature_mismatch" });
});
