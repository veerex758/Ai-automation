import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261114160000_aivanta_marketplace_staged_installation_updates.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../app/api/marketplace/installations/[installationId]/lifecycle/route.ts",import.meta.url),"utf8");
const ui=readFileSync(new URL("../app/marketplace/installations/installation-manager.tsx",import.meta.url),"utf8");
test("staging an update does not switch or pause the currently active installation",()=>{
 assert.match(sql,/previous_status text not null/);
 assert.match(sql,/insert into public\.marketplace_installation_staged_versions/);
 assert.doesNotMatch(sql,/update public\.marketplace_installations set product_version_id=target\.id/);
 assert.match(route,/marketplace_installation_staged_versions/);
 assert.match(route,/marketplace_mark_staged_installation_ready/);\n assert.match(route,/i.status==="active"&&!staged/);
 assert.match(ui,/currently active workflow remains live/);
});
test("candidate becomes live only after successful dry-run and explicit commit",()=>{
 assert.match(sql,/status<>'ready' then raise exception 'successful_staged_dry_run_required'/);
 assert.match(sql,/marketplace_commit_installation_staged_version/);
 assert.match(sql,/set status=case when result_status='active' then 'active' else 'draft' end/);
 assert.match(route,/action==="activate_update"/);
 assert.match(ui,/Apply tested/);
});
test("commit archives previous workflow and records immutable history before switching pointer",()=>{
 assert.match(sql,/marketplace_installation_history/);
 assert.match(sql,/status='archived'/);
 assert.match(sql,/set product_version_id=s\.product_version_id,workflow_id=s\.workflow_id/);
 assert.match(sql,/delete from public\.marketplace_installation_staged_versions/);
});
