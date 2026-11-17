import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261117190000_rexnora_dry_run_dead_letter_recovery.sql", import.meta.url),
  "utf8",
);
const access = readFileSync(new URL("../lib/operations/dead-letter-access.ts", import.meta.url), "utf8");
const listRoute = readFileSync(new URL("../app/api/operations/dead-letters/route.ts", import.meta.url), "utf8");
const replayRoute = readFileSync(new URL("../app/api/operations/dead-letters/[deadLetterId]/replay/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/dashboard/operations/recovery/page.tsx", import.meta.url), "utf8");

test("dead-letter recovery is an audited service-role-only extension", () => {
  assert.match(migration, /execution_dead_letter_recoveries/);
  assert.match(migration, /unique \(dead_letter_id, request_id\)/);
  assert.match(migration, /alter table public\.execution_dead_letter_recoveries enable row level security/);
  assert.match(migration, /revoke all on public\.execution_dead_letter_recoveries from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.create_dead_letter_dry_run_recovery[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.create_dead_letter_dry_run_recovery[\s\S]*?to service_role/);
});

test("operator recovery only clones terminal dry-run snapshots and leaves the original dead letter intact", () => {
  assert.match(migration, /j\.status = 'dead_letter'/);
  assert.match(migration, /j\.execution_mode = 'dry_run'/);
  assert.match(migration, /Only permanently failed dry-run jobs can be recovered automatically/);
  assert.match(migration, /source_job\.workflow_definition/);
  assert.match(migration, /source_job\.payload/);
  assert.match(migration, /'dry_run', 'running'/);
  assert.doesNotMatch(migration, /update public\.execution_jobs[\s\S]*?set status='queued'/);
});

test("operator history and mutation are authenticated, workspace-scoped and owner/admin-only", () => {
  assert.match(access, /auth\.getUser\(\)/);
  assert.match(access, /owner_id !== user\.id && membership\?\.role !== "admin"/);
  assert.match(listRoute, /execution_dead_letters/);
  assert.match(listRoute, /\.eq\("workspace_id", workspace\.id\)/);
  assert.match(listRoute, /execution_dead_letter_recoveries/);
  assert.match(listRoute, /execution_mode/);
  assert.doesNotMatch(listRoute, /select\([^\n]*payload/);
  assert.match(replayRoute, /idempotency-key/i);
  assert.match(replayRoute, /create_dead_letter_dry_run_recovery/);
  assert.match(replayRoute, /Only permanently failed dry-run jobs can be recovered here/);
});

test("recovery screen exposes dry-run-only controls and blocks live replay", () => {
  assert.match(page, /Dry-run only/);
  assert.match(page, /row\.execution_mode === "dry_run"/);
  assert.match(page, /Automatic replay disabled/);
  assert.match(page, /crypto\.randomUUID\(\)/);
  assert.match(page, /recoveries\.map/);
});
