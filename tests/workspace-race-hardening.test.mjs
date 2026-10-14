import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const workspace = source("../lib/supabase/workspace.ts");
const migration = source("../supabase/migrations/20261014010000_aivanta_workspace_race_safe_default.sql");
const route = source("../app/api/workflows/route.ts");

test("default workspace resolution delegates to the atomic database function", () => {
  assert.match(workspace, /rpc\("get_or_create_default_workspace"\)/);
  assert.doesNotMatch(workspace, /\.from\("workspaces"\)[\s\S]*?\.insert\(/);
  assert.match(workspace, /Default workspace could not be resolved/);
});

test("workspace recovery serializes concurrent requests per authenticated user", () => {
  assert.match(migration, /current_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /if current_user_id is null then[\s\S]*?errcode = '28000'/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /hashtextextended\(current_user_id::text, 0\)/);
});

test("workspace recovery repairs membership idempotently without bypassing RLS", () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /on conflict \(workspace_id, user_id\) do nothing/i);
  assert.match(migration, /revoke all on function public\.get_or_create_default_workspace\(\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.get_or_create_default_workspace\(\) to authenticated/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test("workflow API resolves workspace only after authentication and avoids caching user data", () => {
  assert.match(route, /if \(userError \|\| !user\)/);
  assert.match(route, /const workspace = await getOrCreateDefaultWorkspace\(supabase\)/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(route, /Could not load workflows\. Check the Aivanta database configuration and try again\./);
  assert.match(route, /Could not save this workflow\. Check the Aivanta database configuration and try again\./);
  assert.doesNotMatch(route, /return NextResponse\.json\(\{ error: error\.message/);
});
