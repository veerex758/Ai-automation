import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("node installation API is bound to the authenticated default workspace", () => {
  const access = read("../lib/nodes/workspace-access.ts");
  assert.match(access, /supabase\.auth\.getUser\(\)/);
  assert.match(access, /getOrCreateDefaultWorkspace\(supabase\)/);
  assert.match(access, /from\("workspace_members"\)/);
  assert.match(access, /eq\("workspace_id", workspace\.id\)/);
  assert.match(access, /eq\("user_id", user\.id\)/);
  assert.match(access, /role === "owner" \|\| role === "admin"/);
});

test("installation creation validates the approved manifest and records a disabled installation transactionally", () => {
  const route = read("../app/api/nodes/installations/route.ts");
  assert.match(route, /canManageNodeInstallations\(access\.role\)/);
  assert.match(route, /validateNodePackageManifest\(version\.manifest\)/);
  assert.match(route, /manifest\.packageName !== nodePackage\.package_name/);
  assert.match(route, /manifest\.integrity !== version\.artifact_integrity/);
  assert.match(route, /create_workspace_node_installation/);
  assert.match(route, /status: "disabled"/);
  assert.match(route, /blocked_until_isolated_worker/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("installation reads are scoped by RLS before server-only platform metadata lookup", () => {
  const route = read("../app/api/nodes/installations/route.ts");
  const workspaceQuery = route.indexOf('.from("workspace_node_installations")');
  const adminLookup = route.indexOf("createAdminClient()");
  assert.ok(workspaceQuery >= 0 && adminLookup > workspaceQuery);
  assert.match(route, /\.eq\("workspace_id", access\.workspaceId\)/);
  assert.match(route, /\.in\("id", versionIds\)/);
  assert.doesNotMatch(route, /manifest:/);
});

test("installation state API cannot activate or re-enable community packages", () => {
  const route = read("../app/api/nodes/installations/[installationId]/route.ts");
  assert.match(route, /status !== "disabled" && status !== "uninstalled"/);
  assert.match(route, /set_workspace_node_installation_state/);
  assert.match(route, /Activation is blocked until the isolated worker is ready/);
  assert.doesNotMatch(route, /status === "active"/);
});

test("permission API exposes explicit grant and revoke operations only", () => {
  const route = read("../app/api/nodes/installations/[installationId]/permissions/route.ts");
  assert.match(route, /set_workspace_node_permission/);
  assert.match(route, /action: "grant"/);
  assert.match(route, /action: "revoke"/);
  assert.match(route, /canManageNodeInstallations\(access\.role\)/);
  assert.match(route, /Cache-Control.*private, no-store/);
});
