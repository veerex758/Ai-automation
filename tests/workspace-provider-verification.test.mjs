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

test("provider credential verification uses non-destructive identity GET requests", async () => {
  const { verifyWorkspaceProviderCredentials } = await loadTypeScript("../lib/integrations/provider-verification.ts");
  const cases = [
    ["notion", { apiKey: "notion-secret" }, "https://api.notion.com/v1/users/me", { name: "Notion workspace" }, "Notion workspace"],
    ["discord", { botToken: "discord-secret" }, "https://discord.com/api/v10/users/@me", { username: "AivantaBot" }, "AivantaBot"],
    ["telegram", { botToken: "telegram-secret" }, "https://api.telegram.org/bottelegram-secret/getMe", { ok: true, result: { username: "AivantaBot" } }, "@AivantaBot"],
    ["airtable", { accessToken: "airtable-secret" }, "https://api.airtable.com/v0/meta/whoami", { id: "usr_123" }, "Airtable account"],
    ["trello", { apiKey: "trello-key", token: "trello-secret" }, "https://api.trello.com/1/members/me?key=trello-key&token=trello-secret", { username: "trello-user" }, "trello-user"],
    ["hubspot", { accessToken: "hubspot-secret" }, "https://api.hubapi.com/oauth/v1/access-tokens/hubspot-secret", { hub_id: 123, scopes: ["crm.objects.contacts.write"] }, "HubSpot portal 123"],
  ];
  for (const [provider, credentials, expectedUrl, payload, expectedLabel] of cases) {
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedHeaders = {};
    const label = await verifyWorkspaceProviderCredentials(provider, credentials, async (url, options) => {
      requestedUrl = String(url);
      requestedMethod = options.method;
      requestedHeaders = options.headers ?? {};
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    assert.equal(requestedUrl, expectedUrl);
    assert.equal(requestedMethod, "GET");
    assert.equal(label, expectedLabel);
    if (provider === "notion") assert.equal(requestedHeaders.Authorization, "Bearer notion-secret");
    if (provider === "discord") assert.equal(requestedHeaders.Authorization, "Bot discord-secret");
    if (provider === "airtable") assert.equal(requestedHeaders.Authorization, "Bearer airtable-secret");
  }
});

test("provider credential verification rejects invalid tokens and missing HubSpot write scope", async () => {
  const { verifyWorkspaceProviderCredentials } = await loadTypeScript("../lib/integrations/provider-verification.ts");
  await assert.rejects(
    verifyWorkspaceProviderCredentials("notion", { apiKey: "bad" }, async () => new Response("{}", { status: 401 })),
    /PROVIDER_AUTH_REJECTED/
  );
  await assert.rejects(
    verifyWorkspaceProviderCredentials("hubspot", { accessToken: "read-only" }, async () => new Response(JSON.stringify({ scopes: ["crm.objects.contacts.read"] }), { status: 200 })),
    /PROVIDER_AUTH_REJECTED/
  );
  await assert.rejects(
    verifyWorkspaceProviderCredentials("discord", { botToken: "offline" }, async () => { throw new Error("network"); }),
    /PROVIDER_UNREACHABLE/
  );
});
