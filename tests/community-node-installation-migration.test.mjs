import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261103040000_aivanta_safe_community_node_installations.sql", import.meta.url), "utf8");
const policy = readFileSync(new URL("../docs/integrations/community-node-installation-security.md", import.meta.url), "utf8");

test("community node installation records are workspace-scoped and integrity-pinned", () => {
  assert.match(migration, /workspace_id uuid not null references public\\.workspaces/);
  assert.match(migration, /unique \\(workspace_id, package_name\\)/);
  assert.match(migration, /package_integrity[\\s\\S]*sha512-/);
  assert.match(migration, /registry = 'https:\\/\\/registry\\.npmjs\\.org'/);
});

test("installation writes are server-only and audit history is not client-readable", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /private\\.is_workspace_member\\(workspace_id\\)/);
  assert.match(migration, /revoke insert, update, delete on public\\.workspace_node_installations from authenticated/);
  assert.match(migration, /revoke all on public\\.workspace_node_installation_audit from public, anon, authenticated/);
  assert.doesNotMatch(migration, /create policy[^;]*workspace_node_installation_audit/i);
});

test("installed state requires an integrity hash and a reviewed Aivanta adapter", () => {
  assert.match(migration, /status <> 'installed'[\\s\\S]*package_integrity is not null and adapter_id is not null and installed_at is not null/);
  assert.match(migration, /status not in \\('approved','installed','disabled'\\)[\\s\\S]*reviewed_by is not null and reviewed_at is not null/);
});

test("security policy forbids arbitrary package execution and silent updates", () => {
  assert.match(policy, /does not dynamically import arbitrary npm packages/i);
  assert.match(policy, /install lifecycle scripts/i);
  assert.match(policy, /community package code remains non-executable/i);
  assert.match(policy, /Updates never happen silently/i);
});
