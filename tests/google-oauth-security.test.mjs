import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

// Load the actual TypeScript implementation as native ESM for Node 20 tests.
// The Next.js-only marker is removed; production modules retain it.
async function loadTypeScript(relativePath) {
  const sourcePath = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = (await readFile(sourcePath, "utf8")).replace(/^import ["']server-only["'];?\s*/m, "");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: path.basename(sourcePath),
  }).outputText;
  const encoded = Buffer.from(output).toString("base64");
  return import("data:text/javascript;base64," + encoded);
}

const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
const originalGoogleConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI,
};
const validKey = Buffer.alloc(32, 7).toString("base64");

test("Google credential encryption round-trips and uses fresh IVs", async () => {
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = validKey;
  const { encryptGoogleCredentials, decryptGoogleCredentials } =
    await loadTypeScript("../lib/integrations/google-credentials.ts");
  const credentials = {
    access_token: "access-secret",
    refresh_token: "refresh-secret",
    token_type: "Bearer",
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    expiry_date: 1900000000000,
  };

  const first = encryptGoogleCredentials(credentials);
  const second = encryptGoogleCredentials(credentials);
  assert.match(first, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second, "each encryption should use a fresh random IV");
  assert.deepEqual(decryptGoogleCredentials(first), credentials);
  assert.equal(first.includes("access-secret"), false);
  assert.equal(first.includes("refresh-secret"), false);
});

test("Google credential decryption rejects tampering and malformed payloads", async () => {
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = validKey;
  const { encryptGoogleCredentials, decryptGoogleCredentials } =
    await loadTypeScript("../lib/integrations/google-credentials.ts");
  const encrypted = encryptGoogleCredentials({ access_token: "sensitive" });
  const parts = encrypted.split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  assert.throws(() => decryptGoogleCredentials(parts.join(".")));
  assert.throws(() => decryptGoogleCredentials("v2.bad.format"));
  assert.throws(() => decryptGoogleCredentials("v1.a.b.c.extra"));
});

test("Google credential encryption fails closed without a valid 32-byte key", async () => {
  const { encryptGoogleCredentials } =
    await loadTypeScript("../lib/integrations/google-credentials.ts");
  delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  assert.throws(() => encryptGoogleCredentials({ access_token: "x" }), /not configured/);
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
  assert.throws(() => encryptGoogleCredentials({ access_token: "x" }), /32-byte key/);
});

test("Google OAuth scope validation allows only identity plus the requested read-only product scope", async () => {
  const { hasOnlyApprovedGoogleScopes, isGoogleProduct } =
    await loadTypeScript("../lib/integrations/google-oauth.ts");
  const gmail = "https://www.googleapis.com/auth/gmail.readonly";
  const sheets = "https://www.googleapis.com/auth/spreadsheets.readonly";

  assert.equal(isGoogleProduct("gmail"), true);
  assert.equal(isGoogleProduct("sheets"), true);
  assert.equal(isGoogleProduct("drive"), false);
  assert.equal(isGoogleProduct(null), false);
  assert.equal(hasOnlyApprovedGoogleScopes("gmail", "openid email profile " + gmail), true);
  assert.equal(hasOnlyApprovedGoogleScopes("gmail", gmail), true);
  assert.equal(hasOnlyApprovedGoogleScopes("gmail", null), true);
  assert.equal(hasOnlyApprovedGoogleScopes("gmail", "openid email " + sheets), false);
  assert.equal(hasOnlyApprovedGoogleScopes("gmail", "openid email " + gmail + " https://www.googleapis.com/auth/gmail.send"), false);
  assert.equal(hasOnlyApprovedGoogleScopes("sheets", "openid email profile " + sheets), true);
  assert.equal(hasOnlyApprovedGoogleScopes("sheets", "openid email " + gmail), false);
  assert.equal(hasOnlyApprovedGoogleScopes("sheets", 42), false);
});

test("Google OAuth configuration requires HTTPS and the exact callback path", async () => {
  const { getGoogleOAuthConfig } = await loadTypeScript("../lib/integrations/google-oauth.ts");
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_REDIRECT_URI = "https://app.example.com/api/integrations/google/callback";
  assert.deepEqual(getGoogleOAuthConfig(), {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://app.example.com/api/integrations/google/callback",
  });

  process.env.GOOGLE_REDIRECT_URI = "http://app.example.com/api/integrations/google/callback";
  assert.throws(() => getGoogleOAuthConfig(), /HTTPS/);
  process.env.GOOGLE_REDIRECT_URI = "https://app.example.com/wrong";
  assert.throws(() => getGoogleOAuthConfig(), /callback path/);
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/integrations/google/callback";
  assert.equal(getGoogleOAuthConfig().redirectUri, process.env.GOOGLE_REDIRECT_URI);
});

test("Google OAuth configuration rejects missing required environment variables", async () => {
  const { getGoogleOAuthConfig } = await loadTypeScript("../lib/integrations/google-oauth.ts");
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  assert.throws(() => getGoogleOAuthConfig(), /not configured/);
});

test("restore caller environment after this test file", () => {
  if (originalKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey;
  if (originalGoogleConfig.clientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = originalGoogleConfig.clientId;
  if (originalGoogleConfig.clientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = originalGoogleConfig.clientSecret;
  if (originalGoogleConfig.redirectUri === undefined) delete process.env.GOOGLE_REDIRECT_URI;
  else process.env.GOOGLE_REDIRECT_URI = originalGoogleConfig.redirectUri;
});
