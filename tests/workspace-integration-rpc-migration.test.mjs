import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("workspace credential upsert migration avoids PL/pgSQL column-variable ambiguity", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261103090000_aivanta_fix_workspace_integration_secret_upsert.sql", import.meta.url), "utf8");
  assert.match(sql, /v_integration_id uuid/);
  assert.match(sql, /returning id into v_integration_id/);
  assert.match(sql, /insert into public\.workspace_integration_secrets as secrets/);
  assert.match(sql, /on conflict \(integration_id\) do update/);
  assert.match(sql, /revoke all on function public\.save_workspace_integration_credentials/);
  assert.match(sql, /grant execute on function public\.save_workspace_integration_credentials[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /declare\s+integration_id uuid/i);
});
