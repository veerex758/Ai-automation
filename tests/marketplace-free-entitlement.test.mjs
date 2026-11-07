import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const guard=readFileSync(new URL("../supabase/migrations/20261107133700_aivanta_marketplace_free_entitlement_race_guard.sql",import.meta.url),"utf8");
const install=readFileSync(new URL("../supabase/migrations/20261107132600_aivanta_marketplace_install_transition.sql",import.meta.url),"utf8");

test("free marketplace entitlements are unique per buyer and product even under concurrent installs",()=>{
 assert.match(guard,/create unique index if not exists marketplace_entitlements_one_free_per_user_product/);
 assert.match(guard,/on public\.marketplace_entitlements\(user_id,product_id\)/);
 assert.match(guard,/where entitlement_type='free' and purchase_id is null/);
 assert.match(install,/values\(u,p\.id,'free','active'\) on conflict do nothing/);
});
