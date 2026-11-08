import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261105090000_aivanta_database_storage_provider_credentials.sql", import.meta.url), "utf8");

test("database and storage providers are present in both workspace credential allowlists", () => {
  for (const provider of ["supabase", "postgresql", "redis", "firebase", "dropbox", "aws_s3", "cloudflare_r2"]) {
    const occurrences = migration.match(new RegExp("'" + provider + "'", "g")) ?? [];
    assert.equal(occurrences.length, 2, provider + " must be admitted by both the table constraint and credential RPC");
  }
});

test("database and storage credential migration preserves service-role-only writes", () => {
  assert.match(migration, /wm\.role in \('owner','admin'\)/);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_credentials[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_credentials[\s\S]*to service_role/i);
});
