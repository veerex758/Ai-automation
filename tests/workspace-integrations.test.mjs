import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261120130000_rexnora_multi_account_connections.sql", import.meta.url), "utf8");
const connectionMigration = readFileSync(new URL("../supabase/migrations/20261122190000_rexnora_workspace_integration_connections.sql", import.meta.url), "utf8");

test("workspace integration API authenticates and restricts credential management to admins", () => {
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /workspace_members/);
  assert.match(route, /\["owner", "admin"\]/);
  assert.match(route, /encryptWorkspaceCredentials/);
  for (const provider of ["notion", "hubspot", "twilio", "shopify", "stripe", "linear"]) {
    assert.match(route, new RegExp('"' + provider + '"'));
  }
  assert.match(route, /save_workspace_integration_connection/);
});

test("workspace integration API exposes metadata only and never reads stored secrets", () => {
  assert.match(route, /select\("id,provider,status,display_name,last_tested_at,last_test_status,updated_at,metadata"\)/);
  assert.doesNotMatch(route, /select\([^\n]*encrypted_credentials/);
  assert.match(route, /Cache-Control.*private, no-store/);
});

test("credential storage RPC checks workspace role and is service-role only", () => {
  assert.match(migration, /wm\.role in \('owner','admin'\)/);
  assert.match(migration, /insert into public\.workspace_integration_secrets/i);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_connection[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_connection[\s\S]*to service_role/i);
  assert.match(migration, /drop constraint if exists workspace_integrations_workspace_id_provider_key/i);
  assert.match(migration, /where id = p_connection_id[\s\S]*and workspace_id = p_workspace_id[\s\S]*and provider = p_provider/i);
});

test("durable worker decrypts only the required workspace's connected integration", () => {
  assert.match(worker, /eq\("workspace_id", workspaceId\)/);
  assert.match(worker, /decryptWorkspaceCredentials/);
  assert.match(worker, /eq\("integration_id", integration\.id\)/);
  assert.doesNotMatch(worker, /process\.env\.(OPENAI_API_KEY|SLACK_INCOMING_WEBHOOK_URL|RESEND_API_KEY)/);
});


const integrationsDirectory = readFileSync(new URL("../app/dashboard/registry-integrations-directory.tsx", import.meta.url), "utf8");
const workspaceRoute = readFileSync(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const resendVerificationRoute = readFileSync(new URL("../app/api/integrations/workspace/resend/test/route.ts", import.meta.url), "utf8");

test("Resend setup saves encrypted credentials before verifying the saved connection", () => {
  assert.match(integrationsDirectory, /fetch\("\/api\/integrations\/workspace", \{ method:"POST"/);
  assert.match(integrationsDirectory, /const savedConnectionId = typeof savedBody\?\.integration\?\.id === "string"/);
  assert.match(integrationsDirectory, /const verificationPath = provider === "resend"[\s\S]*?\/api\/integrations\/workspace\/resend\/test/);
  assert.match(integrationsDirectory, /const verificationBody = provider === "resend"[\s\S]*?\{ provider, integrationId: savedConnectionId \}/);
  assert.match(integrationsDirectory, /setCredentialValues\(\{\}\)/);
  assert.match(integrationsDirectory, /testedBody\.message/);
  assert.match(integrationsDirectory, /credentialsSaved\s*\?/);
});

test("workspace API encrypts and stores credentials but only returns connection metadata", () => {
  assert.match(workspaceRoute, /encryptWorkspaceCredentials/);
  assert.match(workspaceRoute, /save_workspace_integration_connection/);
  assert.match(workspaceRoute, /return json\(\{ integration: data \}, 201\)/);
  assert.match(workspaceRoute, /select\("id,provider,status,display_name,last_tested_at,last_test_status,updated_at,metadata"\)/);
  assert.doesNotMatch(workspaceRoute, /select\([^\n]*encrypted_credentials/);
});

test("Resend verification decrypts server-side and checks the saved connection without sending email", () => {
  assert.match(resendVerificationRoute, /eq\("id", requestedConnectionId\)\.eq\("workspace_id", workspace\.id\)\.eq\("provider", "resend"\)/);
  assert.match(resendVerificationRoute, /decryptWorkspaceCredentials/);
  assert.match(resendVerificationRoute, /https:\/\/api\.resend\.com\/domains\?limit=100/);
  assert.match(resendVerificationRoute, /senderDomainVerified/);
  assert.match(resendVerificationRoute, /No email was sent/);
  assert.match(resendVerificationRoute, /does not by itself mean the key is invalid/);
  const result = resendVerificationRoute.slice(resendVerificationRoute.lastIndexOf('return json({\n      status: "passed"'));
  assert.doesNotMatch(result, /apiKey|encrypted_credentials/);
});


test("new saves use connection-bound v2 while old v1 records remain compatible",()=>{
 assert.ok(route.includes("encryptWorkspaceCredentialsV2"));
 assert.ok(route.includes("p_create_new: requestedConnectionId === undefined"));
 assert.ok(connectionMigration.includes("encryption_version in ('v1','v2')"));
 assert.ok(connectionMigration.includes("p_create_new boolean"));
 assert.ok(worker.includes('secret.encryption_version === "v2"'));
 assert.ok(worker.includes("integration.id"));
 assert.ok(worker.includes('encryption_version: "v2"'));
});
test("OAuth and provider verification decrypt the exact selected connection",()=>{
 const oauth=readFileSync(new URL("../app/api/integrations/oauth/[provider]/callback/route.ts",import.meta.url),"utf8");
 const providerTest=readFileSync(new URL("../app/api/integrations/workspace/test/route.ts",import.meta.url),"utf8");
 const resendTest=readFileSync(new URL("../app/api/integrations/workspace/resend/test/route.ts",import.meta.url),"utf8");
 const resendEmail=readFileSync(new URL("../app/api/integrations/workspace/resend/test-email/route.ts",import.meta.url),"utf8");
 assert.ok(oauth.includes("encryptWorkspaceCredentialsV2"));
 for(const source of [providerTest,resendTest,resendEmail]){
  assert.ok(source.includes('secret.encryption_version === "v2"'));
  assert.ok(source.includes("integration.id"));
 }
});


test("Resend PR Preview is explicitly routed to the isolated staging Supabase configuration", () => {
  const adminConfig = readFileSync(new URL("../lib/supabase/admin.ts", import.meta.url), "utf8");
  assert.match(adminConfig, /"fix\/resend-connection-domain-status"/);
});
