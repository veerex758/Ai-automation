import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRequestId, logOperationalEvent } from "../lib/observability/safe-log.cjs";

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
