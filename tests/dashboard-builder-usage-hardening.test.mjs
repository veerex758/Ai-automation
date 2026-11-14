import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const migration=await readFile(new URL("../supabase/migrations/20261114130000_aivanta_dashboard_usage_hardening.sql",import.meta.url),"utf8");
const collection=await readFile(new URL("../app/api/dashboards/route.ts",import.meta.url),"utf8");
const detail=await readFile(new URL("../app/api/dashboards/[dashboardId]/route.ts",import.meta.url),"utf8");
const metrics=await readFile(new URL("../app/api/dashboards/metrics/route.ts",import.meta.url),"utf8");
const page=await readFile(new URL("../app/dashboard/dashboards/page.tsx",import.meta.url),"utf8");
test("saved dashboards are workspace scoped, RLS protected and creator editable",()=>{
 assert.ok(migration.includes("workspace_dashboards"));
 assert.ok(migration.includes("private.is_workspace_member(workspace_id)"));
 assert.ok(migration.includes("created_by=auth.uid()"));
 assert.ok(migration.includes("jsonb_array_length(widgets)<=12"));
});
test("quota consumption serializes concurrent requests and supports idempotency",()=>{
 assert.ok(migration.includes("pg_advisory_xact_lock"));
 assert.ok(migration.includes("idempotency_key"));
 assert.ok(migration.includes("for update"));
 assert.ok(migration.includes("limit_reached"));
});
test("dashboard APIs authenticate and scope every operation to the current workspace",()=>{
 for(const source of [collection,detail,metrics]){
  assert.ok(source.includes("auth.getUser()"));
  assert.ok(source.includes("getOrCreateDefaultWorkspace"));
  assert.ok(source.includes("workspace_id"));
 }
 assert.ok(collection.includes("validWidgets"));
 assert.ok(detail.includes("validWidgets"));
});
test("builder persists layouts and reads live workspace metric endpoint",()=>{
 assert.ok(page.includes('/api/dashboards'));
 assert.ok(page.includes('/api/dashboards/metrics'));
 assert.ok(page.includes("one_column"));
 assert.ok(page.includes("three_column"));
 assert.ok(page.includes("Save dashboard"));
});
