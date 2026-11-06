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


test("workspace credentials are cryptographically bound to their workspace and provider", () => {
  const envelope = encryptWorkspaceCredentials(
    { slack: { webhookUrl: "https://hooks.slack.com/services/workspace-secret" } },
    key,
    "workspace-a:slack",
  );
  assert.deepEqual(
    decryptWorkspaceCredentials(envelope, key, "workspace-a:slack"),
    { slack: { webhookUrl: "https://hooks.slack.com/services/workspace-secret" } },
  );
  assert.throws(() => decryptWorkspaceCredentials(envelope, key, "workspace-b:slack"));
  assert.throws(() => decryptWorkspaceCredentials(envelope, key, "workspace-a:resend"));
});

test("workspace credential envelope rejects a wron¶»§q«^