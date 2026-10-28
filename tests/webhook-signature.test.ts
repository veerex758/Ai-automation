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
