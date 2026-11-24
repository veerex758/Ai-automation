import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspaceRoute = readFileSync(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const googleRoute = readFileSync(new URL("../app/api/integrations/google/connections/route.ts", import.meta.url), "utf8");
const revokeMigration = readFileSync(new URL("../supabase/migrations/20261124111000_rexnora_integration_connection_revocation.sql", import.meta.url), "utf8");
const baseIntegrationSchema = readFileSync(new URL("../supabase/migrations/20261031032219_aivanta_workspace_integrations.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const runner = readFileSync(new URL("../nodes/workflow-runner.ts", import.meta.url), "utf8");
const connectionsPage = readFileSync(new URL("../app/dashboard/connections/page.tsx", import.meta.url), "utf8");
const adminConfig = readFileSync(new URL("../lib/supabase/admin.ts", import.meta.url), "utf8");

test("standard integration disconnect is origin-checked, bounded and transaction-backed", () => {
  const handler = workspaceRoute.slice(workspaceRoute.indexOf("export async function DELETE"));
  assert.match(handler, /request\.headers\.get\("origin"\)/);
  assert.match(handler, /sourceOrigin !== targetOrigin/);
  assert.match(handler, /Buffer\.byteLength\(rawBody, "utf8"\) > 4 \* 1024/);
  assert.match(handler, /rpc\("revoke_workspace_integration_connection"/);
  assert.doesNotMatch(handler, /from\("workspace_integrations"\)\.delete/);
  assert.ok(revokeMigration.includes("select wi.* into v_connection") && /for update/i.test(revokeMigration));
  assert.match(revokeMigration, /wm\.role in \('owner','admin'\)/i);
  assert.match(revokeMigration, /delete from public\.workspace_integrations/i);
  assert.match(revokeMigration, /revoke all on function public\.revoke_workspace_integration_connection[\s\S]*from public, anon, authenticated/i);
  assert.match(baseIntegrationSchema, /references public\.workspace_integrations\(id\) on delete cascade/i);
});

test("Google disconnect deletes local credentials transactionally before best-effort provider revocation", () => {
  const handler = googleRoute.slice(googleRoute.indexOf("export async function DELETE"));
  assert.match(handler, /request\.headers\.get\("origin"\)/);
  assert.match(handler, /Buffer\.byteLength\(rawBody, "utf8"\) > 2048/);
  assert.match(handler, /rpc\("revoke_google_connection"/);
  assert.ok(handler.indexOf('rpc("revoke_google_connection"') < handler.indexOf('https://oauth2.googleapis.com/revoke'));
  assert.match(handler, /remoteRevoked/);
  assert.match(googleRoute, /getAdminSupabaseConfig\(\)/);
  assert.match(adminConfig, /fix\/atomic-billing-claims-integration-revoke-20261124/);
  assert.match(revokeMigration, /delete from public\.google_connections/i);
  assert.match(revokeMigration, /revoke all on function public\.revoke_google_connection[\s\S]*from public, anon, authenticated/i);
});

test("each live provider action revalidates the exact selected connection and encrypted secret", () => {
  const resolverIndex = runner.indexOf("resolveStepCredentials");
  const authorizerIndex = runner.indexOf("authorizeOperation");
  assert.ok(resolverIndex >= 0 && authorizerIndex > resolverIndex, "resolve selected account before final authorization");
  assert.match(worker, /activeConnectionIds\.set\(provider, connectionId\)/);
  assert.match(worker, /eq\("id", selectedConnectionId\)[\s\S]*eq\("status", "connected"\)[\s\S]*eq\("last_test_status", "passed"\)/);
  assert.match(worker, /from\("workspace_integration_secrets"\)[\s\S]*eq\("integration_id", selectedConnectionId\)/);
  assert.match(worker, /GOOGLE_CONNECTION_REVOKED_OR_UNVERIFIED/);
  assert.match(worker, /WORKSPACE_CONNECTION_REVOKED_OR_UNVERIFIED/);
});

test("the connections page exposes disconnect controls for workspace and Google accounts", () => {
  assert.match(connectionsPage, /async function disconnectConnection/);
  assert.match(connectionsPage, /method: "DELETE"/);
  assert.match(connectionsPage, /onClick=\{\(\) => void disconnectConnection\(item\.id\)\}/);
  assert.match(connectionsPage, /async function disconnectGoogleConnection/);
  assert.match(connectionsPage, /onClick=\{\(\) => void disconnectGoogleConnection\(connection\.id\)\}/);
});
