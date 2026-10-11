import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRequestId, logOperationalEvent } from "../lib/observability/safe-log.cjs";

test("reuses only bounded, safe request IDs and generates one for invalid values", () => {
  assert.equal(getRequestId("trace_123-ABC"), "trace_123-ABC");
  assert.match(getRequestId("bad id with spaces"), /^[0-9a-f-]{36}$/i);
  assert.match(getRequestId(null), /^[0-9a-f-]{36}$/i);
});

test("writes structured operational fields and drops arbitrary sensitive fields", () => {
  let output = "";
  logOperationalEvent({
    event: "workflow_generation",
    requestId: "trace_123",
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
  assert.equal(record.requestId, "trace_123");
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
  assert.throws(() => logOperationalEvent({ event: "bad event" }, () => {}), /event name is invalid/);

  let output = "";
  logOperationalEvent({
    event: "scheduler_tick",
    requestId: "contains spaces",
    route: "https://example.test",
    outcome: "maybe",
    durationMs: -1,
    errorCode: "raw provider error with secrets",
  }, (line) => { output = line; });
  const record = JSON.parse(output);
  assert.equal("requestId" in record, false);
  assert.equal("route" in record, false);
  assert.equal("outcome" in record, false);
  assert.equal("durationMs" in record, false);
  assert.equal("errorCode" in record, false);
});

test("health, AI generation, and scheduler responses expose request IDs without caching", () => {
  const healthRoute = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
  const aiRoute = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
  const schedulerRoute = readFileSync(new URL("../app/api/internal/scheduler/route.ts", import.meta.url), "utf8");

  for (const route of [healthRoute, aiRoute, schedulerRoute]) {
    assert.ok(route.includes("getRequestId"), "route should create or validate a request ID");
    assert.ok(route.includes('response.headers.set("x-request-id", requestId)'), "route should return the request ID");
  }
  assert.ok(aiRoute.includes("logOperationalEvent"));
  assert.ok(schedulerRoute.includes("logOperationalEvent"));
  assert.ok(aiRoute.includes('response.headers.set("Cache-Control", "no-store")'));
  assert.ok(schedulerRoute.includes('response.headers.set("Cache-Control", "no-store")'));
});
