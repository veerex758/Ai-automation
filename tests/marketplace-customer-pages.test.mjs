import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const storefront=readFileSync(new URL("../app/marketplace/creators/[slug]/page.tsx",import.meta.url),"utf8");
const purchases=readFileSync(new URL("../app/marketplace/purchases/page.tsx",import.meta.url),"utf8");
test("creator storefront is restricted to verified profiles and published products",()=>{
 assert.match(storefront,/\.eq\("status","verified"\)/);
 assert.match(storefront,/\.eq\("status","published"\)/);
 assert.match(storefront,/creator\.id/);
 assert.match(storefront,/notFound\(\)/);
});
test("purchase history requires an authenticated buyer and scopes records to that user",()=>{
 assert.match(purchases,/if\(!user\)redirect/);
 assert.match(purchases,/\.eq\("buyer_user_id",user\.id\)/);
 assert.match(purchases,/\.order\("created_at"/);
});
test("purchase history shows transaction states and product references without exposing provider secrets",()=>{
 for(const state of ["pending","paid","refunded","disputed","failed"])assert.ok(purchases.includes(state));
 assert.match(purchases,/provider_payment_id/);
 assert.doesNotMatch(purchases,/service_role|secret|artifact_path|manifest/i);
});
