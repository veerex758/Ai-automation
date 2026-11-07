import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

async function loadTypeScript(relativePath) {
  const sourcePath = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = (await readFile(sourcePath, "utf8")).replace(/^import ["']server-only["'];?\s*/m, "");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: path.basename(sourcePath),
  }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
}

const originalKey = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
const validKey = Buffer.alloc(32, 19).toString("base64");

test("workspace credentials encrypt and decrypt with authenticated AES-GCM envelopes", async () => {
  process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY = validKey;
  const { encryptWorkspaceCredentials, decryptWorkspaceCredentials } =
    await loadTypeScript("../lib/integrations/workspace-credentials.ts");
  const credentials = { apiKey: "provider-secret", token: "second-secret" };
  const first = encryptWorkspaceCredentials(credentials);
  const second = encryptWorkspaceCredentials(credentials);
  assert.match(first, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second, "each encryption uses a fresh IV");
  assert.deepEqual(decryptWorkspaceCredentials(first), credentials);
  assert.equal(first.includes("provider-secret"), false);
  assert.equal(first.includes("second-secret"), false);
});

test("workspace credential decryption rejects tampering and malformed envelopes", async () => {
  process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY = validKey;
  const { encryptWorkspaceCredentials, decryptWorkspaceCredentials } =
    await loadTypeScript("../lib/integrations/workspace-credentials.ts");
  const parts = encryptWorkspaceCredentials({ apiKey: "secret" }).split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  assert.throws(() => decryptWorkspaceCredentials(parts.join(".")));
  assert.throws(() => decryptWorkspaceCredentials("v2.bad.format"));
  assert.throws(() => decryptWorkspaceCredentials("v1.a.b.c.extra"));
});

test("workspace credential encryption fails closed when the key is absent or malformed", async () => {
  const { encryptWorkspaceCredentials } = await loadTypeScript("../lib/integrations/workspace-credentials.ts");
  delete process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
  assert.throws(() => encryptWorkspaceCredentials({ apiKey: "secret" }), /not configured/);
  process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
  assert.throws(() => encryptWorkspaceCredentials({ apiKey: "secret" }), /32-byte key/);
});

test("restore caller environment", () => {
  if (originalKey === undefined) delete process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
  else process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY = originalKey;
});
