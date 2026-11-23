import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const permissionHelper = readFileSync(new URL("../lib/supabase/permissions.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261122190000_rexnora_workspace_integration_connections.sql", import.meta.url), "utf8");
const directory = readFileSync(new URL("../app/dashboard/registry-integrations-directory.tsx", import.meta.url), "utf8");
const resendVerificationRoute = readFileSync(new URL("../app/api/integrations/workspace/resend/test/route.ts", import.meta.url), "utf8");

test("workspace integration API authenticates and gates credential management", () => {
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /hasWorkspacePermission/);
  assert.match(route, /integrations\.manage/);
  assert.match(permissionHelper, /workspace_members/);
  assert.match(route, /encryptWorkspaceCredentials/);
  assert.match(route, /save_workspace_integration_connection/);
  assert.match(route, /p_created_by: user\.id/);
  assert.match(route, /p_connection_id: connectionId \?\? null/);
  assert.doesNotMatch(route, /\.eq\("provider", provider\)\.maybeSingle\(\)/);
});

test("workspace integration API returns metadata only and never reads stored secrets", () => {
  assert.match(route, /select\("id,provider,status,display_name,last_tested_at,last_test_status,updated_at"\)/);
  assert.doesNotMatch(route, /select\([^\n]*encrypted_credentials/);
  assert.match(route, /Cache-Control.*private, no-store/);
});

test("multi-account credential RPC is workspace-scoped and service-role only", () => {
  assert.match(migration, /wm\.role in \('owner', 'admin'\)/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /insert into public\.workspace_integration_secrets/i);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_connection[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_connection[\s\S]*to service_role/i);
  assert.match(migration, /drop constraint if exists workspace_integrations_workspace_id_provider_key/i);
  assert.match(migration, /where wi\.id = p_connection_id[\s\S]*and wi\.workspace_id = p_workspace_id[\s\S]*and wi\.provider = p_provider/i);
});

test("durable worker resolves one exact tested account before each provider node", () => {
  assert.match(worker, /context\.resolveStepCredentials = async/);
  assert.match(worker, /selectedConnectionIds\.get\(provider\)/);
  assert.match(worker, /WORKSPACE_CONNECTION_SELECTION_REQUIRED/);
  assert.match(worker, /\.eq\("id", selectedConnectionId\)/);
  assert.match(worker, /\.eq\("workspace_id", workspaceId\)/);
  assert.match(worker, /\.eq\("status", "connected"\)/);
  assert.match(worker, /\.eq\("last_test_status", "passed"\)/);
  assert.match(worker, /decryptWorkspaceCredentials/);
  assert.doesNotMatch(worker, /process\.env\.(OPENAI_API_KEY|SLACK_INCOMING_WEBHOOK_URL|RESEND_API_KEY)/);
});

test("Resend account setup saves credentials before verification and never sends a test email", () => {
  assert.match(directory, /fetch\("\/api\/integrations\/workspace", \{ method:"POST"/);
  assert.match(directory, /const savedConnectionId = typeof savedBody\?\.integration\?\.id === "string"/);
  assert.match(directory, /verificationBody = provider === "resend"/);
  assert.match(resendVerificationRoute, /decryptWorkspaceCredentials/);
  assert.match(resendVerificationRoute, /No email was sent/);
  assert.doesNotMatch(resendVerificationRoute.slice(resendVerificationRoute.lastIndexOf('return json({\n      status: "passed"')), /apiKey|encrypted_credentials/);
});