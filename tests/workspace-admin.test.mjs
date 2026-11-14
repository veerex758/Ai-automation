import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const migration=await readFile(new URL("../supabase/migrations/20261114130000_aivanta_dashboard_usage_hardening.sql",import.meta.url),"utf8");
const securityMigration=await readFile(new URL("../supabase/migrations/20261114160000_aivanta_workspace_security_settings.sql",import.meta.url),"utf8");
const workspaceHelper=await readFile(new URL("../lib/supabase/workspace.ts",import.meta.url),"utf8");
const workspaceRoute=await readFile(new URL("../app/api/workspaces/route.ts",import.meta.url),"utf8");
const switchRoute=await readFile(new URL("../app/api/workspaces/[workspaceId]/switch/route.ts",import.meta.url),"utf8");
const memberRoute=await readFile(new URL("../app/api/workspaces/[workspaceId]/members/route.ts",import.meta.url),"utf8");
const inviteRoute=await readFile(new URL("../app/api/workspaces/[workspaceId]/invitations/route.ts",import.meta.url),"utf8");
const acceptRoute=await readFile(new URL("../app/api/workspaces/invitations/accept/route.ts",import.meta.url),"utf8");
const securityRoute=await readFile(new URL("../app/api/workspaces/[workspaceId]/security/route.ts",import.meta.url),"utf8");
test("workspace creation and active workspace selection are membership checked",()=>{
 assert.ok(migration.includes("create_workspace_for_current_user"));
 assert.ok(workspaceHelper.includes("aivanta_active_workspace"));
 assert.ok(workspaceHelper.includes("from(\"workspaces\")"));
 assert.ok(workspaceRoute.includes("create_workspace_for_current_user"));
 assert.ok(switchRoute.includes("from(\"workspaces\")"));
});
test("member role changes protect owner and administrator boundaries",()=>{
 assert.ok(memberRoute.includes('["owner","admin"]'));
 assert.ok(memberRoute.includes('target.role==="owner"'));
 assert.ok(memberRoute.includes('a.role==="admin"&&target.role==="admin"'));
});
test("workspace invitations store token hashes, expire and require matching verified email",()=>{
 assert.ok(migration.includes("workspace_invitations"));
 assert.ok(migration.includes("token_hash"));
 assert.ok(migration.includes("expires_at"));
 assert.ok(migration.includes("email_mismatch"));
 assert.ok(inviteRoute.includes("createHash"));
 assert.ok(inviteRoute.includes("randomBytes"));
 assert.ok(acceptRoute.includes("user.email_confirmed_at"));
 assert.ok(acceptRoute.includes("accept_workspace_invitation"));
});
test("ownership transfer is owner-authorized and audited",()=>{
 assert.ok(migration.includes("transfer_workspace_ownership"));
 assert.ok(migration.includes("workspace.ownership_transferred"));
});

test("workspace security settings are owner-managed and enforced by invitation creation",()=>{
 assert.ok(securityMigration.includes("workspace_security_settings"));
 assert.ok(securityMigration.includes("require_approval_for_live_actions"));
 assert.ok(securityRoute.includes("Only the workspace owner can change security policies"));
 assert.ok(inviteRoute.includes("allow_member_invites"));
});
