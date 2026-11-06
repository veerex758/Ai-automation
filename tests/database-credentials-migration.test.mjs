import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261106213337_mysql_mongodb_workspace_credentials.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollback/20261106213337_mysql_mongodb_workspace_credentials.down.sql", import.meta.url), "utf8");
const workspaceRoute = await readFile(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const connectionTest = await readFile(new URL("../app/api/integrations/workspace/test/route.ts", import.meta.url), "utf8");

test("MySQL and MongoDB credential migration extends the provider allowlist and uses a server-only saver", () => {
  assert.ok(migration.includes("'mysql','mongodb'"));
  assert.ok(migration.includes("create or replace function public.save_workspace_database_credentials"));
  assert.ok(migration.includes("security invoker"));
  assert.ok(migration.includes("p_provider not in ('mysql','mongodb')"));
  assert.ok(migration.includes("workspace_members wm"));
  assert.ok(migration.includes("wm.role in ('owner','admin')"));
  assert.ok(migration.includes("encrypted_credentials"));
  assert.ok(migration.includes("grant execute on function public.save_workspace_database_credentials"));
  assert.ok(workspaceRoute.includes("save_workspace_database_credentials"));
});

test("database credential rollback refuses to remove provider support ¶»§q«^