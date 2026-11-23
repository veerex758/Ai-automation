import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const migration=await readFile(new URL("../supabase/migrations/20261114170000_aivanta_durable_dispatch_usage_metering.sql",import.meta.url),"utf8");
const dispatch=await readFile(new URL("../app/api/workflows/[workflowId]/dispatch/route.ts",import.meta.url),"utf8");
const webhook=await readFile(new URL("../app/api/webhooks/[endpointKey]/route.ts",import.meta.url),"utf8");
const scheduler=await readFile(new URL("../app/api/internal/scheduler/route.ts",import.meta.url),"utf8");
test("durable dispatch reserves one execution atomically with run and queue insertion",()=>{
 assert.ok(migration.includes("AIVANTA_WORKFLOW_EXECUTION_LIMIT_REACHED"));
 assert.ok(migration.includes("'workflow_execution',1"));
 assert.ok(migration.includes("idempotency_key"));
 assert.ok(migration.includes("pg_advisory_xact_lock"));
 assert.ok(migration.includes("insert into public.workflow_runs"));
 assert.ok(migration.includes("insert into public.execution_jobs"));
});
test("all durable entry points provide a validated actor and use atomic dispatch metering",()=>{
 assert.ok(dispatch.includes("p_created_by: user.id"));
 assert.ok(webhook.includes("p_created_by: dispatchActor"));
 assert.ok(webhook.includes("workspaceOwner"));
 assert.ok(webhook.includes("select(\"owner_id\")"));
 assert.ok(scheduler.includes("p_created_by: scheduleConfig.created_by"));
 assert.ok(migration.includes("reserve_workspace_execution_service"));
 assert.ok(!webhook.includes("reserve_workspace_execution_service"), "webhook must not reserve usage a second time after atomic dispatch");
 assert.ok(webhook.includes("dispatch_workflow_execution"));
 assert.ok(migration.includes("AIVANTA_WORKFLOW_EXECUTION_LIMIT_REACHED"));
});
