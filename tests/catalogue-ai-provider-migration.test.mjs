import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261105030000_aivanta_catalogue_ai_providers.sql", import.meta.url), "utf8");

test("first catalogue AI providers are allowed by both the table constraint and secure credential RPC", () => {
  for (const provider of ["elevenlabs", "stability_ai", "hugging_face", "pinecone"]) {
    const occurrences = migration.match(new RegExp("'" + provider + "'", "g")) ?? [];
    assert.equal(occurrences.length, 2, provider + " must be admitted by both database allowlists");
  }
});

test("catalogue AI credential migration retains workspace-admin and service-role boundaries", () => {
  assert.match(migration, /wm\.role in \('owner','admin'\)/);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_credentials[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_credentials[\s\S]*to service_role/i);
});
