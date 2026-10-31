import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptWebhookSecret, encryptWebhookSecret } from "../lib/webhooks/secret-crypto";

const key = Buffer.alloc(32, 7).toString("base64");

test("encrypts and decrypts webhook secrets without storing plaintext", () => {
  const secret = "test-only-webhook-secret";
  const encrypted = encryptWebhookSecret(secret, key);
  assert.notEqual(encrypted.toString("utf8"), secret);
  assert.equal(decryptWebhookSecret(encrypted, key), secret);
});

test("uses randomized authenticated ciphertext", () => {
  const first = encryptWebhookSecret("same-secret", key);
  const second = encryptWebhookSecret("same-secret", key);
  assert.notDeepEqual(first, second);
  assert.equal(decryptWebhookSecret(first, key), "same-secret");
});

test("rejects tampering, wrong keys, malformed envelopes and invalid key length", () => {
  const encrypted = encryptWebhookSecret("secret", key);
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptWebhookSecret(tampered, key));
  assert.throws(() => decryptWebhookSecret(encrypted, Buffer.alloc(32, 8).toString("base64")));
  assert.throws(() => decryptWebhookSecret(Buffer.from([1, 2, 3]), key));
  assert.throws(() => encryptWebhookSecret("secret", Buffer.from("short").toString("base64")));
});
