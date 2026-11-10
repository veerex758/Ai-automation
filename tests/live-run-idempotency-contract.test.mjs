import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const legacyRoute = readFileSync(
  new URL("../app/api/workflows/[workflowId]/live-run/route.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../supabase/migrations/20261010201327_aivanta_live_email_runs.sql", import.meta.url),
  "utf8",
);

test("legacy live-run endpoint delegates to the registry execution contract", () => {
  assert.match(legacyRoute, /registryRun\(request, context\)/);
});

test("requires a UUID idempotency key before a live run can be created", () => {
  assert.match(route, /request\.headers\.get\(["']idempotency-key["']\)/i);
  assert.match(route, /if\s*\(!dryRun\s*&&\s*!uuid\.test\(idempotencyKey\)\)/i);
  assert.match(route, /UUID Idempotency-Key header is required/i);
});

test("scopes duplicate lookup to the authenticated actor and workflow", () => {
  const lookupStart = route.indexOf("const { data: prior }");
  assert.notEqual(lookupStart, -1);
  const lookupEnd = route.indexOf("if (prior)", lookupStart);
  assert.ok(lookupEnd > lookupStart);
  const lookup = route.slice(lookupStart, lookupEnd);

  assert.match(lookup, /\.eq\(["']idempotency_key["'],\s*idempotencyKey\)/);
  assert.match(lookup, /\.eq\(["']created_by["'],\s*user\.id\)/);
  assert.match(lookup, /\.eq\(["']workflow_id["'],\s*workflowId\)/);
});

test("returns an existing run before invoking registered workflow operations", () => {
  const duplicateCheck = route.indexOf("if (prior) return NextResponse.json");
  const providerExecution = route.indexOf("const execution = dryRunExecution ?? await executeRegisteredWorkflow");
  assert.ok(duplicateCheck >= 0, "existing run must be detected");
  assert.ok(providerExecution > duplicateCheck, "duplicate response must happen before provider execution");
  assert.match(route.slice(duplicateCheck, providerExecution), /duplicate:\s*true/);
});

test("handles concurrent unique-key collisions before a second provider execution", () => {
  const collision = route.indexOf('if (insertError?.code === "23505" && !dryRun)');
  const providerExecution = route.indexOf("const execution = dryRunExecution ?? await executeRegisteredWorkflow");
  assert.ok(collision >= 0, "unique-index collision must be handled");
  assert.ok(providerExecution > collision, "collision handling must precede provider execution");

  const collisionBlock = route.slice(collision, providerExecution);
  assert.match(collisionBlock, /\.eq\(["']idempotency_key["'],\s*idempotencyKey\)/);
  assert.match(collisionBlock, /\.eq\(["']created_by["'],\s*user\.id\)/);
  assert.match(collisionBlock, /\.eq\(["']workflow_id["'],\s*workflow\.id\)/);
  assert.match(collisionBlock, /duplicate:\s*true/);
});

test("persists a unique idempotency key before any live provider operation", () => {
  assert.match(migration, /create unique index if not exists workflow_runs_idempotency_key_uidx/i);
  assert.match(migration, /on public\.workflow_runs\s*\(idempotency_key\)/i);
  const insertRun = route.indexOf("const { data: run, error: insertError }");
  const providerExecution = route.indexOf("const execution = dryRunExecution ?? await executeRegisteredWorkflow");
  assert.ok(insertRun >= 0 && providerExecution > insertRun);
  assert.match(route.slice(insertRun, providerExecution), /idempotency_key:\s*dryRun\s*\?\s*null\s*:\s*idempotencyKey/);
});

test("does not recommend retrying after run history fails following a possible side effect", () => {
  assert.match(route, /external side effect may already have occurred/i);
  assert.match(route, /retrySafe:\s*dryRun/);
  assert.match(route, /Check run history before retrying/i);
});
