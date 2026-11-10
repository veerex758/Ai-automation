import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const route=readFileSync(new URL("../app/api/marketplace/catalog/route.ts",import.meta.url),"utf8");

test("marketplace catalog exposes allowlisted filters and deterministic sorting",()=>{
 assert.match(route,/types=\["workflow","pack","agent"\]/);
 assert.match(route,/sorts=\["recent","price_low","price_high","name"\]/);
 assert.match(route,/pricing==="free"/);
 assert.match(route,/pricing==="paid"/);
 assert.match(route,/category\.slug/);
});
test("marketplace catalog pagination is bounded and returns navigation metadata",()=>{
 assert.match(route,/Math\.min\(10000/);
 assert.match(route,/Math\.min\(60/);
 assert.match(route,/\.range\(/);
 assert.match(route,/totalPages/);
 assert.match(route,/hasNext/);
 assert.match(route,/hasPrevious/);
});
test("catalog only returns published listings and never artifacts or manifests",()=>{
 assert.match(route,/\.eq\("status","published"\)/);
 assert.doesNotMatch(route,/artifact_path|manifest|service_role/i);
});
