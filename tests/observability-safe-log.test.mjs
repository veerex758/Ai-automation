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

test("successful workflow generation logs Gemini provider and model without prompt or credentials", () => {
  let output = "";
  logOperationalEvent({
    event: "workflow_generation", requestId, route: "/api/ai/generate-workflow",
    outcome: "success", statusCode: 200, durationMs: 18,
    provider: "gemini", model: "gemini-3.8-flash",
    prompt: "private customer data", apiKey: "secret-key",
  }, value => { output = value; });
  const record = JSON.parse(output);
  assert.equal(record.provider, "gemini");
  assert.equal(record.model, "gemini-3.8-flash");
  logOperationalEvent({
    event: "workflow_generation", requestId, providerStatus: 400,
    providerReason: "INVALID_ARGUMENT", providerType: "invalid_request",
    providerRequestId: "gemini-req-123",
    providerMessage: "must never be logged", prompt: "private prompt", apiKey: "secret",
  }, value => { output = value; });
  const diagnostic = JSON.parse(output);
  assert.equal(diagnostic.providerStatus, 400);
  assert.equal(diagnostic.providerReason, "INVALID_ARGUMENT");
  assert.equal(diagnostic.providerType, "invalid_request");
  assert.equal(diagnostic.providerRequestId, "gemini-req-123");
  assert.equal("providerMessage" in diagnostic, false);
  assert.equal("prompt" in diagnostic, false);
  assert.equal("apiKey" in diagnostic, false);
  logOperationalEvent({ event: "workflow_generation", providerReason: "bad value; secret" }, value => { output = value; });
  assert.equal("providerReason" in JSON.parse(output), false);
  assert.equal("prompt" in record, false);
  assert.equal("apiKey" in record, false);
});


test("safe operational logs retain provider token totals but discard arbitrary sensitive values", () => {
  let output = "";
  logOperationalEvent({
    event: "workflow_generation",
    requestId,
    route: "/api/ai/generate-workflow",
    outcome: "success",
    statusCode: 200,
    provider: "gemini",
    model: "gemini-3.8-flash",
    providerInputTokens: 120,
    providerOutputTokens: 45,
    providerTotalTokens: 165,
    prompt: "private lead prompt",
    apiKey: "private-provider-key",
    costDetails: { raw: "private" },
  }, value => { output = value; });
  const record = JSON.parse(output);
  assert.equal(record.providerInputTokens, 120);
  assert.equal(record.providerOutputTokens, 45);
  assert.equal(record.providerTotalTokens, 165);
  assert.equal("prompt" in record, false);
  assert.equal("apiKey" in record, false);
  assert.equal("costDetails" in record, false);
});

test("workflow generation logs the selected Gemini fallback without sensitive data", () => {
  let output = "";
  logOperationalEvent({
    event: "workflow_generation",
    requestId,
    route: "/api/ai/generate-workflow",
    outcome: "success",
    statusCode: 200,
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    fallbackUsed: true,
    prompt: "private prompt",
  }, value => { output = value; });
  const record = JSON.parse(output);
  assert.equal(record.model, "gemini-3.5-flash-lite");
  assert.equal(record.fallbackUsed, true);
  assert.equal("prompt" in record, false);
  logOperationalEvent({
    event: "workflow_generation",
    outcome: "failure",
    errorCode: "AI_PROVIDER_OVERLOADED",
    providerStatus: 503,
  }, value => { output = value; });
  assert.equal(JSON.parse(output).errorCode, "AI_PROVIDER_OVERLOADED");
});


test("Gemini provider-attempt logs retain bounded diagnostics and omit request content", () => {
  let output = "";
  logOperationalEvent({
    event: "workflow_generation",
    requestId,
    route: "/api/ai/generate-workflow",
    outcome: "failure",
    statusCode: 503,
    provider: "gemini",
    model: "gemini-3.8-flash",
    providerStatus: 503,
    providerAttempt: 2,
    retryAfterMs: 1500,
    providerRequestId: "google-request-1",
    prompt: "private property enquiry",
    apiKey: "secret",
  }, value => { output = value; });
  const record = JSON.parse(output);
  assert.equal(record.providerAttempt, 2);
  assert.equal(record.retryAfterMs, 1500);
  assert.equal(record.providerStatus, 503);
  assert.equal("prompt" in record, false);
  assert.equal("apiKey" in record, false);
  logOperationalEvent({
    event: "workflow_generation",
    errorCode: "AI_PROVIDER_COOLDOWN",
    providerAttempt: -1,
    retryAfterMs: "secret",
  }, value => { output = value; });
  const bounded = JSON.parse(output);
  assert.equal(bounded.errorCode, "AI_PROVIDER_COOLDOWN");
  assert.equal("providerAttempt" in bounded, false);
  assert.equal("retryAfterMs" in bounded, false);
});
