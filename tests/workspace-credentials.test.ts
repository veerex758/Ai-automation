import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptWorkspaceCredentials, encryptWorkspaceCredentials } from "../lib/integrations/workspace-credentials";

const key = randomBytes(32).toString("base64");

test("workspace credentials round-trip with provider-scoped fields", () => {
  const credentials = {
    openai: { apiKey: "sk-test-secret" },
    slack: { webhookUrl: "https://hooks.slack.com/services/test" },
    resend: { apiKey: "re_test", fromEmail: "automation@example.test" },
  };
  const encrypted = encryptWorkspaceCredentials(credentials, key);
  assert.match(encrypted, /^v1\./);
  assert.notEqual(encrypted.includes("sk-test-secret"), true);
  assert.deepEqual(decryptWorkspaceCredentials(encrypted, key), credentials);
});

test("workspace credential envelope rejects a wrong key and tampering", () => {
  const encrypted = encryptWorkspaceCredentials({ openai: { apiKey: "secret" } }, key);
  assert.throws(() => decryptWorkspaceCredentials(encrypted, randomBytes(32).toString("base64")));
  const pieces = encrypted.split(".");
  pieces[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decryptWorkspaceCredentials(pieces.join("."), key));
});

test("workspace credential validator rejects unknown providers, fields and empty secrets", () => {
  assert.throws(() => encryptWorkspaceCredentials({ unknown: { apiKey: "secret" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ openai: { password: "secret" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ slack: { webhookUrl: " " } }, key));
});

test("workspace credential decryption requires a valid versioned envelope", () => {
  assert.throws(() => decryptWorkspaceCredentials("v2.invalid.invalid.invalid", key));
  assert.throws(() => decryptWorkspaceCredentials("v1.a.b.c.extra", key));
});
