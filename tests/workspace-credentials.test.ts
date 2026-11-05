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


test("workspace credential vault accepts the first four catalogue AI providers", () => {
  const value = {
    elevenlabs: { apiKey: "eleven-secret" },
    stability_ai: { apiKey: "stability-secret" },
    hugging_face: { apiKey: "hf-secret" },
    pinecone: { apiKey: "pinecone-secret", indexHost: "https://index.svc.us-east1-gcp.pinecone.io" },
  };
  const encrypted = encryptWorkspaceCredentials(value, key, "workspace-ai:providers");
  assert.deepEqual(decryptWorkspaceCredentials(encrypted, key, "workspace-ai:providers"), value);
  assert.throws(() => encryptWorkspaceCredentials({ pinecone: { apiKey: "key" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ elevenlabs: { apiKey: "key", endpoint: "https://untrusted.test" } } as never, key));
});


test("workspace credential vault accepts CRM and Teams provider fields without accepting extras", () => {
  const value = {
    microsoft_teams: { accessToken: "teams-token" },
    salesforce: { accessToken: "salesforce-token", instanceUrl: "https://acme.my.salesforce.com" },
    pipedrive: { accessToken: "pipedrive-token" },
    zoho_crm: { accessToken: "zoho-token" },
    freshsales: { accessToken: "freshsales-token", domain: "acme.myfreshworks.com" },
    close: { apiKey: "close-key" },
    apollo: { apiKey: "apollo-key" },
    intercom: { accessToken: "intercom-token" },
  };
  const encrypted = encryptWorkspaceCredentials(value, key, "workspace-crm:providers");
  assert.deepEqual(decryptWorkspaceCredentials(encrypted, key, "workspace-crm:providers"), value);
  assert.throws(() => encryptWorkspaceCredentials({ salesforce: { accessToken: "token" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ close: { apiKey: "key", password: "extra" } } as never, key));
});


test("workspace credential vault accepts the CRM and messaging provider fields", () => {
  const value = {
    microsoft_teams: { accessToken: "teams-token" },
    salesforce: { accessToken: "salesforce-token", instanceUrl: "https://acme.my.salesforce.com" },
    pipedrive: { accessToken: "pipedrive-token" },
    zoho_crm: { accessToken: "zoho-token" },
    freshsales: { accessToken: "freshsales-token", domain: "acme.myfreshworks.com" },
    close: { apiKey: "close-key" },
    apollo: { apiKey: "apollo-key" },
    intercom: { accessToken: "intercom-token" },
  };
  const encrypted = encryptWorkspaceCredentials(value, key, "workspace-crm:providers");
  assert.deepEqual(decryptWorkspaceCredentials(encrypted, key, "workspace-crm:providers"), value);
  assert.throws(() => encryptWorkspaceCredentials({ salesforce: { accessToken: "token" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ close: { apiKey: "key", password: "extra" } } as never, key));
});


test("workspace credential vault accepts productivity and developer provider fields", () => {
  const value = {
    jira: { siteUrl: "https://acme.atlassian.net", email: "admin@example.test", apiToken: "jira-token" },
    asana: { accessToken: "asana-token" },
    trello: { apiKey: "trello-key", token: "trello-token" },
    clickup: { token: "clickup-token" },
    monday: { apiToken: "monday-token" },
    todoist: { accessToken: "todoist-token" },
    airtable: { accessToken: "airtable-token" },
    bitbucket: { accessToken: "bitbucket-token" },
    netlify: { token: "netlify-token" },
  };
  const encrypted = encryptWorkspaceCredentials(value, key, "workspace-productivity:providers");
  assert.deepEqual(decryptWorkspaceCredentials(encrypted, key, "workspace-productivity:providers"), value);
  assert.throws(() => encryptWorkspaceCredentials({ jira: { siteUrl: "https://acme.atlassian.net", apiToken: "token" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ trello: { apiKey: "key" } } as never, key));
});


test("workspace credential vault accepts payment and support provider fields", () => {
  const value = {
    woocommerce: { storeUrl: "https://shop.example.test", consumerKey: "ck-test", consumerSecret: "cs-test" },
    paypal: { clientId: "paypal-client", clientSecret: "paypal-secret", environment: "sandbox" },
    paddle: { apiKey: "paddle-key" },
    lemon_squeezy: { apiKey: "lemon-key", storeId: "12345" },
    square: { accessToken: "square-token", environment: "sandbox" },
    razorpay: { keyId: "rzp-test", keySecret: "razor-secret" },
    zoom: { accessToken: "zoom-token" },
    cal_com: { apiKey: "cal-key" },
    twilio_voice: { accountSid: "AC-placeholder-test", authToken: "voice-secret", fromPhone: "+15550001111" },
    docusign: { accessToken: "docusign-token", accountId: "account-1", baseUri: "https://na4.docusign.net" },
  };
  const encrypted = encryptWorkspaceCredentials(value, key, "workspace-commerce:providers");
  assert.deepEqual(decryptWorkspaceCredentials(encrypted, key, "workspace-commerce:providers"), value);
  assert.throws(() => encryptWorkspaceCredentials({ paypal: { clientId: "id", clientSecret: "secret" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ square: { accessToken: "token" } } as never, key));
});


test("workspace credential vault accepts social and marketing provider fields", () => {
  const value = {
    x_twitter: { accessToken: "x-token" },
    linkedin: { accessToken: "linkedin-token" },
    facebook_pages: { pageAccessToken: "facebook-page-token" },
    instagram: { accessToken: "instagram-token", igUserId: "ig-user-1" },
    tiktok: { accessToken: "tiktok-token" },
    mailchimp: { apiKey: "mailchimp-us20" },
    typeform: { accessToken: "typeform-token" },
  };
  const encrypted = encryptWorkspaceCredentials(value, key, "workspace-marketing:providers");
  assert.deepEqual(decryptWorkspaceCredentials(encrypted, key, "workspace-marketing:providers"), value);
  assert.throws(() => encryptWorkspaceCredentials({ instagram: { accessToken: "token" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ facebook_pages: { pageAccessToken: "token", apiKey: "extra" } } as never, key));
});


test("workspace credential vault accepts database and storage provider fields", () => {
  const value = {
    supabase: { projectUrl: "https://project.supabase.co", apiKey: "supabase-test-key" },
    postgresql: { connectionString: "postgresql://user:password@db.example.test:5432/app?sslmode=require" },
    redis: { restUrl: "https://example.upstash.io", token: "redis-token" },
    firebase: { projectId: "aivanta-project1", accessToken: "firebase-token" },
    dropbox: { accessToken: "dropbox-token" },
    aws_s3: { accessKeyId: "aws-access-id", secretAccessKey: "aws-secret", region: "us-east-1" },
    cloudflare_r2: { accountId: "abcdef0123456789abcdef0123456789", accessKeyId: "r2-access-id", secretAccessKey: "r2-secret" },
  };
  const encrypted = encryptWorkspaceCredentials(value, key, "workspace-database:providers");
  assert.deepEqual(decryptWorkspaceCredentials(encrypted, key, "workspace-database:providers"), value);
  assert.throws(() => encryptWorkspaceCredentials({ supabase: { projectUrl: "https://project.supabase.co" } } as never, key));
  assert.throws(() => encryptWorkspaceCredentials({ aws_s3: { accessKeyId: "id", region: "us-east-1" } } as never, key));
});
