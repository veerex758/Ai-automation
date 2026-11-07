import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20261107132900_aivanta_marketplace_creator_moderation_gate.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../app/api/marketplace/admin/creators/[creatorId]/route.ts",import.meta.url),"utf8");

test("public listings and installs require an active verified creator",()=>{
 assert.match(migration,/c\.status='verified'/);
 assert.match(migration,/p\.creator_id is not null and not exists/);
 assert.match(migration,/drop policy if exists marketplace_products_public_read/);
});

test("creator moderation and audit are one privileged database transaction",()=>{
 assert.match(migration,/create or replace function public\.marketplace_moderate_creator/);
 assert.match(migration,/if auth\.role\(\)<>'service_role'/);
 assert.match(migration,/insert into public\.marketplace_admin_audit/);
 assert.match(migration,/grant execute on function public\.marketplace_moderate_creator\(uuid,uuid,text,text\) to service_role/);
});

test("creator moderation API delegates state change and audit to the atomic RPC",()=>{
 assert.match(route,/rpc\("marketplace_moderate_creator"/);
 assert.doesNotMatch(route,/from\("marketplace_creators"\)\.update/);
 assert.doesNotMatch(route,/from\("marketplace_admin_audit"\)\.insert/);
});
