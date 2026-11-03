import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261103050000_aivanta_integration_provider_allowlist.sql", import.meta.url), "utf8");

test("workspace integration provider constraint includes the supported vendor integrations", () => {
  for (const provider of ["notion", "hubspot", "twilio", "shopify", "stripe", "linear"]) {
    assert.match(migration, new RegExp("'" + provider + "'"));
  }
  assert.match(migration, /drop constraint if exists workspace_integrations_provider_check/);
  assert.match(migration, /add constraint workspace_integrations_provider_check/);
});

test("credential save RPC keeps provider allowlist and admin-only service-role write boundary", () => {
  assert.match(migration, /p_provider not in \([\s\S]*'notion'[\s\S]*'linear'[\s\S]*\)/);
  assert.match(migration, /wm\.role in \('owner','admin'\)/);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_credentials[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_credentials[\s\S]*to service_role/i);
});
