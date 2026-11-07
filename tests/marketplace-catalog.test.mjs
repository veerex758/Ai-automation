import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const route=readFileSync(new URL("../app/api/marketplace/products/route.ts",import.meta.url),"utf8");

test("catalog search strips PostgREST filter syntax and caps user input",()=>{
 assert.ok(route.includes("replace(/[\\\\p{L}\\\\p{N}\\\\s_-]/gu"));
 assert.match(route,/\.slice\(0, 80\)/);
 assert.doesNotMatch(route,/searchParams\.get\("q"\)\?\.trim\(\)\.slice/);
});

test("public catalog is bounded and only queries published listings",()=>{
 assert.match(route,/\.eq\("status", "published"\)/);
 assert.match(route,/\.limit\(60\)/);
 assert.match(route,/\["workflow", "pack", "agent"\]/);
});
