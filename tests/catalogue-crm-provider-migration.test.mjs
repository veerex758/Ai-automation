import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261105040000_aivanta_catalogue_crm_providers.sql", import.meta.url), "utf8");

test("CRM and Teams providers are admitted by both database credential allowlists", () => {
  for (const provider of ["microsoft_teams", "salesforce", "pipedrive", "zoho_crm", "freshsales", "close", "apollo", "intercom"]) {
    const occurrences = migration.match(new RegExp("'" + provider + "'", "g")) ?? [];
    assert.equal(occurrences.length, 2, provider + " must be present in the table constraint and credential RPC");
  }
});

test("CRM and Teams migration preserves workspace authorization and service-role-only writes", () => {
  assert.match(migration, /wm\.role in \('owner','admin'\)/);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_credentials[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_credentials[\s\S]*to service_role/i);
});
