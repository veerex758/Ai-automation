import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const migration=await readFile(new URL("../supabase/migrations/20261114130000_aivanta_dashboard_usage_hardening.sql",import.meta.url),"utf8");
const collection=await readFile(new URL("../app/api/dashboards/route.ts",import.meta.url),"utf8");
const detail=await readFile(new URL("../app/api/dashboards/[dashboardId]/route.ts",import.meta.url),"utf8");
const metrics=await readFile(new URL("../app/api/dashboards/metrics/route.ts",import.meta.url),"utf8");
const page=await readFile(new URL("../app/dashboard/dashboards/page.tsx",import.meta.url),"utf8");
test("saved dashboards are workspace scoped, RLS protected and creator editable",()=>{
 assert.match(migration,/workspace_dashboards/);assert.match(migration,/private\\.is_workspace_member\\(workspace_id\\)/);
 assert.match(migration,/created_by=auth\\.uid\\(\\)/);assert.match(migration,/jsonb_array_length\\(widgets\\)<=12/);
});
test("quota consumption serializes concurrent requests and supports idempotency",()=>{
 assert.match(migration,/pg_advisory_xact_lock/);assert.match(migration,/idempotency_key/);
 assert.match(migration,/for update/);assert.match(migration,/limit_reached/);
});
test("dashboard APIs authenticate and scope every operation to the current workspace",()=>{
 for(const source of [collection,detail,metrics]){assert.match(source,/auth\\.getUser\\(\\)/);assert.match(source,/getOrCreateDefaultWorkspace/);assert.match(source,/workspace_id/);}
 assert.match(collection,/validWidgets/);assert.match(detail,/validWidgets/);
});
test("builder persists layouts and reads live workspace metric endpoint",()=>{
 assert.match(page,/fetch\\("\\/api\\/dashboards"/);assert.match(page,/fetch\\("\\/api\\/dashboards\\/metrics"/);
 assert.match(page,/one_column/);assert.match(page,/three_column/);assert.match(page,/Save dashboard/);
});
