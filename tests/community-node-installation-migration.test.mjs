import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261103040000_aivanta_safe_community_node_installations.sql", import.meta.url), "utf8");
const policy = readFileSync(new URL("../docs/integrations/community-node-installation-security.md", import.meta.url), "utf8");

test("community node installation records are workspace-scoped and integrity-pinned", () => {
  assert.ok(migration.includes("workspace_id uuid not null references public.workspaces"));
  assert.ok(migration.includes("unique (workspace_id, package_name)"));
  assert.ok(migration.includes("package_integrity text"));
  assert.ok(migration.includes("sha512-"));
  assert.ok(migration.includes("registry = 'https://registry.npmjs.org'"));
});

test("installation writes are server-only and audit history is not client-readable", () => {
  assert.ok(migration.includes("enable row level security"));
  assert.ok(migration.includes("private.is_workspace_member(workspace_id)"));
  assert.ok(migration.includes("revoke insert, update, delete on public.workspace_node_installations from authenticated"));
  assert.ok(migration.includes("revoke all on public.workspace_node_installation_audit from public, anon, authenticated"));
  assert.ok(!/create policy[^;]*workspace_node_installation_audit/i.test(migration));
});

test("installed state requires an integrity hash and a reviewed Aivanta adapter", () => {
  assert.ok(migration.includes("package_integrity is not null and adapter_id is not null and installed_at is not null"));
  assert.ok(migration.includes("reviewed_by is not null and reviewed_at is not null"));
});

test("security policy forbids arbitrary package execution and silent updates", () => {
  assert.ok(policy.includes("does not dynamically import arbitrary npm packages"));
  assert.ok(policy.includes("install lifecycle scripts"));
  assert.ok(policy.includes("community package code remains non-executable"));
  assert.ok(policy.includes("Updates never happen silently"));
});
