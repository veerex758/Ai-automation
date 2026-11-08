import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261105060000_aivanta_productivity_provider_credentials.sql", import.meta.url), "utf8");

test("productivity and developer providers are present in both credential allowlists", () => {
  for (const provider of ["jira", "asana", "trello", "clickup", "monday", "todoist", "airtable", "bitbucket", "netlify"]) {
    const occurrences = migration.match(new RegExp("'" + provider + "'", "g")) ?? [];
    assert.equal(occurrences.length, 2, provider + " must be allowed by both the table constraint and credential RPC");
  }
});

test("productivity credential migration preserves workspace admin and service-role write boundaries", () => {
  assert.match(migration, /wm\.role in \('owner','admin'\)/);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_credentials[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_credentials[\s\S]*to service_role/i);
});
