import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRequestId, logOperationalEvent } from "../lib/observability/safe-log.cjs";
import { callSchedulerRpc } from "../lib/observability/scheduler-rpc.cjs";

const validRequestId = "123e4567-e89b-42d3-a456-426614174000";

test("accepts only UUID-shaped request IDs and generates one for arbitrary input", () => {
  assert.equal(getRequestId(validRequestId), validRequestId);
  assert.match(getRequestId("trace_123-ABC"), /^[0-9a-f-]{36}$/i);
  assert.match(getRequestId("bad id with spaces"), /^[0-9a-f-]{36}$/i);
  assert.match(getRequestId(null), /^[0-9a-f-]{36}$/i);
});

test("writes structured operational fields and drops arbitrary sensitive fields", () => {
  let output = "";
  logOperationalEvent({
    event: "workflow_generation",
    requestId: validRequestId,
    route: "/api/ai/generate-workflow",
    outcome: "failure",
    statusCode: 502,
    durationMs: 45,
    errorCode: "AI_PROVIDER_ERROR",
    prompt: "private prompt text",
    email: "owner@example.test",
    token: "do-not-log",
    authorization: "Bearer secret",
  }, (line) => { output = line; });

  const record = JSON.parse(output);
  assert.equal(record.service, "aivanta");
  assert.equal(record.requestId, validRequestId);
  assert.equal(record.errorCode, "AI_PROVIDER_ERROR");
  assert.equal(record.statusCode, 502);
  assert.equal("prompt" in record, false);
  assert.equal("email" in record, false);
  assert.equal("token" in record, false);
  assert.equal("authorization" in record, false);
  assert.equal(output.includes("private prompt text"), false);
  assert.equal(output.includes("do-not-log"), false);
});

test("rejects invalid event names and omits invalid field values", () => {
  assert.throws(() => logOperationalEvent({ event: "unreviewed_event" }, () => {}), /event name is invalid/);

  let output = "";
  logOperationalEvent({
    event: "scheduler_tick",
    requestId: "contains spaces",
    route: "https://example.test",
    outcome: "maybe",
    durationMs: -1,
    errorCode: "SECRET_VALUE",
  }, (line) => { output = line; });
  const record = JSON.parse(output);
  assert.equal("requestId" in record, false);
  assert.equal("route" in record, false);
  assert.equal("outcome" in record, false);
  assert.equal("durationMs" in record, false);
  assert.equal("errorCode" in record, false);
});

test("preserves only reviewed stable error codes emitted by AI and scheduler paths", () => {
  const reviewedErrorCodes = [
    "AI_PROVIDER_ERROR",
    "AI_NOT_CONFIGURED",
    "AI_CONFIGURATION_ERROR",
    "AI_TIMEOUT",
    "AI_PROVIDER_UNAVAILABLE",
    "AI_PROVIDER_AUTH_ERROR",
    "AI_RATE_LIMITED",
    "AI_INVALID_RESPONSE",
    "AI_EMPTY_RESPONSE",
    "AI_INVALID_JSON",
    "AI_UNSAFE_WORKFLOW",
    "SCHEDULER_UNAUTHORIZED",
    "SCHEDULER_AUTH_NOT_CONFIGURED",
    "SCHEDULER_DATABASE_NOT_CONFIGURED",
    "SCHEDULER_CLAIM_FAILED",
    "SCHEDULED_RUN_FAILED",
    "INVALID_WORKFLOW_DEFINITION",
    "SCHEDULED_RUN_PERSISTENCE_FAILED",
    "SCHEDULED_RUN_FINALIZATION_FAILED",
  ];

  for (const errorCode of reviewedErrorCodes) {
    let output = "";
    logOperationalEvent({
      event: "scheduler_tick",
      errorCode,
    }, (line) => { output = line; });
    assert.equal(JSON.parse(output).errorCode, errorCode, `reviewed error code should remain available: ${errorCode}`);
  }
});


test("health, AI generation, and scheduler responses expose request IDs without caching", () => {
  const healthRoute = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
  const aiRoute = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
  const schedulerRoute = readFileSync(new URL("../app/api/internal/scheduler/route.ts", import.meta.url), "utf8");

  for (const route of [healthRoute, aiRoute, schedulerRoute]) {
    assert.ok(route.includes("getRequestId"), "route should create or validate a request ID");
    assert.ok(route.includes('response.headers.set("x-request-id", requestId)'), "route should return the request ID");
  }
  assert.ok(healthRoute.includes('"Cache-Control": "no-store"'), "health response should not be cached");
  assert.ok(aiRoute.includes("logOperationalEvent"));
  assert.ok(schedulerRoute.includes("logOperationalEvent"));
  assert.ok(aiRoute.includes('response.headers.set("Cache-Control", "no-store")'));
  assert.ok(schedulerRoute.includes('response.headers.set("Cache-Control", "no-store")'));
});

test("scheduler contains claim and finalization transport failures", () => {
  const schedulerRoute = readFileSync(new URL("../app/api/internal/scheduler/route.ts", import.meta.url), "utf8");
  const finishClaim = schedulerRoute.slice(
    schedulerRoute.indexOf("async function finishClaim"),
    schedulerRoute.indexOf("async function dispatchTick"),
  );

  assert.ok(finishClaim.includes("try {"), "claim finalization should guard transport exceptions");
  assert.ok(finishClaim.includes("catch {"), "claim finalization should handle thrown RPC errors");
  assert.ok(finishClaim.includes("return false;"), "failed finalization should report an unfinalized lease");
  assert.ok(schedulerRoute.includes("claimFailed = true;"), "claim RPC exceptions should be treated as failures");
  assert.ok(schedulerRoute.includes("workflowStartedAt"), "scheduled workflow failures should be timed");

  const finalizationFailureBranch = schedulerRoute.slice(
    schedulerRoute.indexOf("if (!finalized)"),
    schedulerRoute.indexOf("succeeded += 1;", schedulerRoute.indexOf("if (!finalized)")),
  );
  assert.ok(finalizationFailureBranch.includes('"SCHEDULED_RUN_FINALIZATION_FAILED"'));
  assert.ok(finalizationFailureBranch.includes('event: "scheduled_workflow"'));
  assert.ok(finalizationFailureBranch.includes("logOperationalEvent"));
});

test("scheduler routes claim, persistence, and finalization through the safe wrapper", () => {
  const route = readFileSync(new URL("../app/api/internal/scheduler/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes('callSchedulerRpc(supabase.rpc.bind(supabase), "claim_due_workflow_schedules"'));
  assert.ok(route.includes('callSchedulerRpc(supabase.rpc.bind(supabase), "record_scheduled_workflow_run"'));
  assert.ok(route.includes('callSchedulerRpc(supabase.rpc.bind(supabase), "finish_workflow_schedule_claim"'));
  assert.ok(route.includes("SCHEDULED_RUN_PERSISTENCE_FAILED"));
});

test("scheduler RPC wrapper contains thrown claim transport errors without leaking details", async () => {
  const secret = "postgres://private-host/internal-secret";
  const result = await callSchedulerRpc(async () => { throw new Error(secret); }, "claim_due_workflow_schedules", {});
  assert.equal(result.data, null);
  assert.equal(result.error.message, "SCHEDULER_RPC_TRANSPORT_FAILED");
  assert.equal(result.error.message.includes(secret), false);
});

test("scheduler RPC wrapper classifies thrown persistence transport errors", async () => {
  let called = "";
  const result = await callSchedulerRpc(async (name) => {
    called = name;
    throw new Error("connection reset with credentials");
  }, "record_scheduled_workflow_run", {});
  assert.equal(called, "record_scheduled_workflow_run");
  assert.equal(result.data, null);
  assert.equal(result.error.message, "SCHEDULER_RPC_TRANSPORT_FAILED");
  assert.equal(result.error.message.includes("credentials"), false);
});

test("scheduler RPC wrapper treats thrown finalization as failure, never success", async () => {
  const result = await callSchedulerRpc(async () => { throw new Error("temporary network failure"); }, "finish_workflow_schedule_claim", {});
  assert.notEqual(result.data, true);
  assert.ok(result.error);
});

test("scheduler RPC wrapper preserves returned RPC errors and successful dry-run record responses", async () => {
  const returnedError = await callSchedulerRpc(async () => ({ data: null, error: { message: "denied" } }), "claim_due_workflow_schedules", {});
  assert.equal(returnedError.error.message, "denied");

  let providerCalls = 0;
  const success = await callSchedulerRpc(async () => ({ data: [{ status: "succeeded", sideEffectsPerformed: false }], error: null }), "claim_due_workflow_schedules", {});
  assert.equal(success.error, null);
  assert.equal(success.data[0].sideEffectsPerformed, false);
  assert.equal(providerCalls, 0, "RPC wrapper must not invoke external providers");
});
