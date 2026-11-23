import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const permissionHelper = readFileSync(new URL("../lib/supabase/permissions.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261102091000_aivanta_workspace_integration_secret_upsert.sql", import.meta.url), "utf8");

test("workspace integration API authenticates and restricts credential management to admins", () => {
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /hasWorkspacePermission/);
  assert.match(route, /integrations.manage/);
  assert.match(permissionHelper, /workspace_members/);
  assert.match(route, /encryptWorkspaceCredentials/);
  for (const provider of ["notion", "hubspot", "twilio", "shopify", "stripe", "linear"]) {
    assert.match(route, new RegExp('"' + provider + '"'));
  }
  assert.match(route, /save_workspace_integration_credentials/);
});

test("workspace integration API exposes metadata only and never reads stored secrets", () => {
  assert.match(route, /select\("id,provider,status,display_name,last_tested_at,last_test_status,updated_at"\)/);
  assert.doesNotMatch(route, /select\([^\n]*encrypted_credentials/);
  assert.match(route, /Cache-Control.*private, no-store/);
});

test("credential storage RPC checks workspace role and is service-role only", () => {
  assert.match(migration, /wm\.role in \('owner','admin'\)/);
  assert.match(migration, /insert into public\.workspace_integration_secrets/i);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_credentials[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_credentials[\s\S]*to service_role/i);
});

test("durable worker decrypts only the required workspace's connected integration", () => {
  assert.match(worker, /eq\("workspace_id", workspaceId\)/);
  assert.match(worker, /decryptWorkspaceCredentials/);
  assert.match(worker, /eq\("integration_id", integration\.id\)/);
  assert.doesNotMatch(worker, /process\.env\.(OPENAI_API_KEY|SLACK_INCOMING_WEBHOOK_URL|RESEND_API_KEY)/);
});
