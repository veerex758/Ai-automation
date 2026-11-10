import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("dashboard overview opts into responsive horizontal navigation",async()=>{
 const page=await readFile(new URL("../app/dashboard/page.tsx",import.meta.url),"utf8");
 const css=await readFile(new URL("../app/dashboard/dashboard.css",import.meta.url),"utf8");
 assert.match(page,/className="app-shell dashboard-overview-page"/);
 assert.match(css,/\.dashboard-overview-page \.sidebar/);
 assert.match(css,/@media\s*\(max-width:\s*720px\)/);
 assert.match(css,/overflow-x:\s*auto/);
});
