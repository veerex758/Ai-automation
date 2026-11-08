import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261106213337_mysql_mongodb_workspace_credentials.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollback/20261106213337_mysql_mongodb_workspace_credentials.down.sql", import.meta.url), "utf8");
const workspaceRoute = await readFile(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const connectionTest = await readFile(new URL("../app/api/integrations/workspace/test/route.ts", import.meta.url), "utf8");

test("MySQL and MongoDB credential migration adds only the intended provider values and a server-only RPC", () => {
  assert.match(migration, /'mysql','mongodb'/);
  assert.match(migration, /create or replace function public\.save_workspace_database_credentials/);
  assert.match(migration, /security definer/);
  assert.match(migration, /p_provider not in \('mysql', 'mongodb'\)/);
  assert.match(migration, /revoke all on function public\.save_workspace_database_credentials/);
  assert.match(migration, /grant execute on function public\.save_workspace_database_credentials/);
  assert.match(workspaceRoute, /workspace_members/);
  assert.match(workspaceRoute, /save_workspace_database_credentials/);
  assert.match(workspaceRoute, /p_encrypted_credential: encrypted/);
});

test("database rollback refuses to discard customer credentials before narrowing the provider constraint", () => {
  assert.match(rollback, /where provider in \('mysql','mongodb'\)/);
  assert.match(rollback, /raise exception/);
  assert.match(rollback, /drop function if exists public\.save_workspace_database_credentials/);
  const narrowedConstraint = rollback.slice(rollback.indexOf("check (provider in"));
  assert.ok(narrowedConstraint.length > 0);
  assert.doesNotMatch(narrowedConstraint, /'mysql'|'mongodb'/);
});

test("connection verification uses real MySQL and MongoDB drivers with TLS validation", () => {
  assert.match(connectionTest, /createMysqlConnection/);
  assert.match(connectionTest, /new MongoClient/);
  assert.match(connectionTest, /ssl: \{ rejectUnauthorized: true \}/);
  assert.match(connectionTest, /tlsAllowInvalidCertificates: false/);
  assert.match(connectionTest, /case "mysql":/);
  assert.match(connectionTest, /case "mongodb":/);
});
