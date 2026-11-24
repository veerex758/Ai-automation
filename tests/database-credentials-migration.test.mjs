import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261106213337_mysql_mongodb_workspace_credentials.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollback/20261106213337_mysql_mongodb_workspace_credentials.down.sql", import.meta.url), "utf8");
const connectionMigration = await readFile(new URL("../supabase/migrations/20261122190000_rexnora_workspace_integration_connections.sql", import.meta.url), "utf8");
const securityMigration = await readFile(new URL("../supabase/migrations/20261124110000_rexnora_security_keyring_and_ingress_rate_limits.sql", import.meta.url), "utf8");
const workspaceRoute = await readFile(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const connectionTest = await readFile(new URL("../app/api/integrations/workspace/test/route.ts", import.meta.url), "utf8");
const permissionHelper = await readFile(new URL("../lib/supabase/permissions.ts", import.meta.url), "utf8");

test("MySQL and MongoDB credential migration adds only the intended provider values and a server-only RPC", () => {
  assert.match(migration, /'mysql','mongodb'/);
  assert.match(migration, /create or replace function public\.save_workspace_database_credentials/);
  assert.match(migration, /security definer/);
  assert.match(migration, /p_provider not in \('mysql', 'mongodb'\)/);
  assert.match(migration, /revoke all on function public\.save_workspace_database_credentials/);
  assert.match(migration, /grant execute on function public\.save_workspace_database_credentials/);
  assert.match(workspaceRoute, /workspace_members/);
  assert.match(workspaceRoute, /!\["owner", "admin"\]\.includes\(membership\.role\)/);
  assert.match(permissionHelper, /workspace_members/);
  assert.match(workspaceRoute, /INTEGRATION_PERMISSION_DENIED/);
  assert.match(connectionMigration, /create or replace function public\.save_workspace_database_credentials/);
  assert.match(connectionMigration, /security invoker/i);
  assert.match(connectionMigration, /revoke all on function public\.save_workspace_database_credentials[\s\S]*from public,\s*anon,\s*authenticated/i);
  assert.match(connectionMigration, /grant execute on function public\.save_workspace_database_credentials[\s\S]*to service_role/i);
  assert.match(workspaceRoute, /save_workspace_integration_connection/);
  assert.match(workspaceRoute, /p_provider: provider/);
  assert.match(workspaceRoute, /p_encrypted_credentials: encrypted/);
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


test("credential migration supports v3 while preserving v1 and v2 ciphertexts", () => {
  assert.ok(securityMigration.includes("encryption_version in ('v1', 'v2', 'v3')"));
  assert.ok(securityMigration.includes("p_encrypted_credentials ~ '^v3"));
  assert.ok(securityMigration.includes("p_encrypted_credentials ~ '^v[12]"));
  assert.ok(securityMigration.includes("wm.workspace_id=p_workspace_id"));
  assert.ok(securityMigration.includes("wm.user_id=p_created_by"));
});

test("shared API limiter is atomic, hashed and service-role only", () => {
  assert.ok(securityMigration.includes("on conflict (scope, key_hash) do update"));
  assert.ok(securityMigration.includes("key_digest := md5(p_key)"));
  assert.ok(securityMigration.includes("enable row level security"));
  assert.ok(securityMigration.includes("revoke all on public.api_rate_limit_buckets from public, anon, authenticated"));
  assert.ok(securityMigration.includes("revoke all on function public.consume_api_rate_limit"));
  assert.ok(securityMigration.includes("grant execute on function public.consume_api_rate_limit"));
});
