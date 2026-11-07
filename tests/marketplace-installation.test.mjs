import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20261107133000_aivanta_marketplace_install_workflow_copy.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../app/api/marketplace/products/[productId]/install/route.ts",import.meta.url),"utf8");

test("Marketplace install materializes a verified version as an inactive workspace draft",()=>{
 assert.match(migration,/create or replace function public\.marketplace_materialize_installation/);
 assert.match(migration,/i\.installed_by<>p_actor_id/);
 assert.match(migration,/p\.current_version_id<>i\.product_version_id/);
 assert.match(migration,/v\.verification_status='approved'/);
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
