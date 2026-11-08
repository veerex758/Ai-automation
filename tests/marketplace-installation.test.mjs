import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20261107133000_aivanta_marketplace_install_workflow_copy.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../app/api/marketplace/products/[productId]/install/route.ts",import.meta.url),"utf8");

test("Marketplace install materializes a verified version as an inactive workspace draft",()=>{
 assert.match(migration,/marketplace_entitlements_one_free_per_user_product/);
 assert.match(migration,/create or replace function public\.marketplace_materialize_installation/);
 assert.match(migration,/i\.installed_by<>p_actor_id/);
 assert.match(migration,/workspace_access_denied/);
 assert.match(migration,/installation_removed/);
 assert.match(migration,/active_entitlement_required/);
 assert.match(migration,/p\.current_version_id<>i\.product_version_id/);
 assert.match(migration,/verification_status='approved'/);
 assert.match(migration,/'draft',\s*p_actor_id/);
 assert.match(migration,/grant execute on function public\.marketplace_materialize_installation\(uuid,uuid,text\) to service_role/);
});

test("install route verifies private artifact bytes before materializing a workflow",()=>{
 assert.match(route,/verifyMarketplaceStoredArtifact/);
 assert.match(route,/marketplace-artifacts/);
 assert.match(route,/marketplace_materialize_installation/);
 assert.match(route,/status:"draft"/);
 assert.match(route,/installationRecord\.product_version_id!==version\.id/);
});

test("reinstall does not silently replace a customer's pinned version",()=>{
 assert.match(migration,/update_available',true/);
 assert.match(migration,/existing\.product_version_id<>v\.id/);
 assert.doesNotMatch(migration,/set product_version_id=v\.id/);
});

const privileges=readFileSync(new URL("../supabase/migrations/20261107133100_aivanta_marketplace_installation_column_privileges.sql",import.meta.url),"utf8");
test("workspace members can edit configuration but cannot alter install lifecycle or workflow linkage",()=>{
 assert.match(privileges,/revoke update on public\.marketplace_installations from authenticated/);
 assert.match(privileges,/grant update\(configuration\) on public\.marketplace_installations to authenticated/);
 assert.match(privileges,/create policy marketplace_installations_workspace_update/);
 assert.match(privileges,/private\.is_workspace_member\(workspace_id\)/);
});

const transitionSecurity=readFileSync(new URL("../supabase/migrations/20261107133200_aivanta_marketplace_installation_transition_security.sql",import.meta.url),"utf8");
test("installation lifecycle and workflow linkage are not client-writable",()=>{
 assert.match(transitionSecurity,/revoke insert, update on public\.marketplace_installations from authenticated/);
 assert.match(transitionSecurity,/drop policy if exists marketplace_installations_workspace_insert/);
 assert.match(transitionSecurity,/drop policy if exists marketplace_installations_workspace_update/);
 assert.match(transitionSecurity,/grant execute on function public\.marketplace_install_product\(uuid,uuid\) to authenticated/);
 assert.match(transitionSecurity,/grant execute on function public\.marketplace_materialize_installation\(uuid,uuid,text\) to service_role/);
});

test("installation lifecycle requires a recorded successful dry run and supports rollback history",()=>{const sql=readFileSync(new URL("../supabase/migrations/20261108140000_aivanta_marketplace_installation_lifecycle.sql",import.meta.url),"utf8"),route=readFileSync(new URL("../app/api/marketplace/installations/[installationId]/route.ts",import.meta.url),"utf8"),update=readFileSync(new URL("../supabase/migrations/20261108150000_aivanta_marketplace_install_update_version.sql",import.meta.url),"utf8");assert.match(sql,/workflow_runs r/);assert.match(sql,/r\.mode='dry_run'/);assert.match(sql,/r\.status='succeeded'/);assert.match(sql,/installation_dry_run_required/);assert.match(sql,/marketplace_installation_history/);assert.match(sql,/p_action='rollback'/);assert.match(route,/dry_run_passed/);assert.match(route,/uninstall/);assert.match(update,/workflow_id=null/);});
