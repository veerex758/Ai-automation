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


test("workspace credential vault accepts the additional vendor providers with only declared fields", () => {
  const value = {
    notion: { apiKey: "notion-secret" },
    hubspot: { accessToken: "hubspot-secret" },
    twilio: { accountSid: "AC123", authToken: "twilio-secret", fromPhone: "+15550001111" },
    shopify: { shopDomain: "example.myshopify.com", accessToken: "shopify-secret" },
    stripe: { secretKey: "stripe-secret" },
    linear: { apiKey: "linear-secret" },
    slack: { botToken: "slack-bot-secret" },
    claude: { apiKey: "claude-secret" },
    discord: { botToken: "discord-secret" },
    whatsapp_business: { accessToken: "wa-secret", phoneNumberId: "123456" },
    sendgrid: { apiKey: "sg-secret", fromEmail: "hello@example.test" },
    mailgun: { apiKey: "mg-secret", domain: "mg.example.test", fromEmail: "hello@example.test" },
    postmark: { serverToken: "pm-secret", fromEmail: "hello@example.test" },
    github: { token: "gh-secret" },
    gitlab: { token: "gl-secret" },
    sentry: { authToken: "sentry-secret" },
    vercel: { token: "vercel-secret" },
    calendly: { accessToken: "calendly-secret" },
    zendesk: { subdomain: "acme", email: "admin@example.test", apiToken: "zd-secret" },
    freshdesk: { domain: "acme", apiKey: "fd-secret" },
    serpapi: { apiKey: "serp-secret" },
    openweather: { apiKey: "weather-secret" },
  };
  const encrypted = encryptWorkspaceCredentials(value, key, "workspace-1:integration-set");
  assert.deepEqual(decryptWorkspaceCredentials(encrypted, key, "workspace-1:integration-set"), value);
  assert.throws(() => encryptWorkspaceCredentials({ notion: { apiKey: "ok", accessToken: "not-allowed" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ twilio: { accountSid: "AC123" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ slack: {} } as never, key));
});
