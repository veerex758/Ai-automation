import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyCommunityWorkerSignature } from "../lib/nodes/community-worker";

test("community worker signatures bind timestamp, nonce, and exact request body", () => {
  const secret = "test-secret-that-is-at-least-32-characters-long";
  const timestamp = String(Date.now());
  const nonce = "unique-request-nonce";
  const body = JSON.stringify({ invocationId: "inv-1", input: { value: 3 } });
  const signature = createHmac("sha256", secret).update(timestamp + "." + nonce + "." + body).digest("hex");
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp, nonce, body, signature }), true);
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp, nonce, body: body + " ", signature }), false);
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp, nonce: nonce + "x", body, signature }), false);
});

test("community worker signature rejects stale timestamps and malformed digests", () => {
  const secret = "test-secret-that-is-at-least-32-characters-long";
  const timestamp = String(Date.now() - 60_000);
  const nonce = "nonce";
  const body = "{}";
  const signature = createHmac("sha256", secret).update(timestamp + "." + nonce + "." + body).digest("hex");
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp, nonce, body, signature }), false);
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp: "NaN", nonce, body, signature }), false);
  assert.equal(verifyCommunityWorkerSignature({ secret, timestamp: String(Date.now()), nonce, body, signature: "bad" }), false);
});
