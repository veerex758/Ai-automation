import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getRequestId, logOperationalEvent } from "../lib/observability/safe-log.cjs";
import { callSchedulerRpc } from "../lib/observability/scheduler-rpc.cjs";

const requestId = "123e4567-e89b-42d3-a456-426614174000";

test("request IDs accept only UUIDs and replace arbitrary values", () => {
  assert.equal(getRequestId(requestId), requestId);
  assert.match(getRequestId("trace secret"), /^[0-9a-f-]{36}$/i);
});

test("operational logs retain only allowlisted safe fields", () => {
  let output = "";
  logOperationalEvent({
    event: "live_workflow_run",
    requestId,
    route: "/api/workflows/live-run",
    outcome: "failure",
    statusCode: 500,
    durationMs: 42,
    errorCode: "LIVE_RUN_FAILED",
    prompt: "customer email with secret",
    workflowId: "private-workflow-id",
    token: "private-token",
  }, value => { output = value; });
  const record = JSON.parse(output);
  assert.equal(record.event, "live_workflow_run");
  assert.equal(record.requestId, requestId);
  assert.equal(record.errorCode, "LIVE_RUN_FAILED");
  assert.equal("prompt" in record, false);
  assert.equal("workflowId" in record, false);
  assert.equal("token" in record, false);
});

test("operational logger rejects unreviewed event names and error codes", () => {
  assert.throws(() => logOperationalEvent({ event: "arbitrary_event" }, () => {}), /event name is invalid/);
  let output = "";
  logOperationalEvent({ event: "scheduler_tick", errorCode: "raw-secret-error" }, value => { output = value; });
  assert.equal("errorCode" in JSON.parse(output), false);
});

test("scheduler RPC wrapper contains thrown transport errors", async () => {
  const secret = "postgres://user:password@private-host";
  const result = await callSchedulerRpc(async () => { throw new Error(secret); }, "claim_due_workflow_schedules", {});
  assert.equal(result.data, null);
  assert.equal(result.error.message, "SCHEDULER_RPC_TRANSPORT_FAILED");
  assert.doesNotMatch(result.error.message, /postgres|password|private-host/);
});

test("AI, live-run, and scheduler routes use request IDs and safe operational logging", async () => {
  const paths = [
    "../app/api/ai/generate-workflow/route.ts",
    "../app/api/workflows/[workflowId]/live-run/route.ts",
    "../app/api/internal/scheduler/route.ts",
  ];
  const sources = await Promise.all(paths.map(path => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of sources) {
    assert.match(source, /getRequestId/);
    assert.match(source, /logOperationalEvent/);
    assert.match(source, /x-request-id/);
  }
  assert.doesNotMatch(sources[1], /console\.error\([^)]*persistenceError/);
  assert.doesNotMatch(sources[1], /console\.error\([^)]*recoveryError/);
});
