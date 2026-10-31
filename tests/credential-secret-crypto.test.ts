import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptCredentialSecret, encryptCredentialSecret } from "../lib/credentials/secret-crypto";

const key = randomBytes(32).toString("base64");
const context = "workspace-123:slack";

test("credential encryption round-trips and uses a fresh nonce", () => {
  const first = encryptCredentialSecret(JSON.stringify({ token: "secret-value" }), key, context);
  const second = encryptCredentialSecret(JSON.stringify({ token: "secret-value" }), key, context);
  assert.equal(decryptCredentialSecret(first, key, context), JSON.stringify({ token: "secret-value" }));
  assert.notDeepEqual(first, second);
});

test("credential encryption rejects missing or malformed keys and empty secrets", () => {
  assert.throws(() => encryptCredentialSecret("secret", "", context), /required/i);
  assert.throws(() => encryptCredentialSecret("secret", Buffer.from("short").toString("base64"), context), /32 bytes/i);
  assert.throws(() => encryptCredentialSecret("", key, context), /16384/i);
});

test("credential ciphertext is bound to workspace/provider context", () => {
  const envelope = encryptCredentialSecret("token", key, context);
  assert.throws(() => decryptCredentialSecret(envelope, key, "another-workspace:slack"));
  assert.throws(() => decryptCredentialSecret(envelope, key, "workspace-123:google"));
});

test("credential decryption rejects tampered and malformed envelopes", () => {
  const envelope = encryptCredentialSecret("token", key, context);
  const tampered = Buffer.from(envelope);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptCredentialSecret(tampered, key, context));
  assert.throws(() => decryptCredentialSecret(Buffer.from([2, 1, 2]), key, context), /malformed/i);
});
