import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const nodeTypes = readFileSync(new URL("../nodes/types.ts", import.meta.url), "utf8");
const runner = readFileSync(new URL("../nodes/workflow-runner.ts", import.meta.url), "utf8");
const email = readFileSync(new URL("../nodes/email.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const dispatch = readFileSync(new URL("../app/api/workflows/[workflowId]/dispatch/route.ts", import.meta.url), "utf8");
const webhook = readFileSync(new URL("../app/api/webhooks/[endpointKey]/route.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/20261124130000_rexnora_execution_reliability_retries.sql", import.meta.url),
  "utf8",
);
const privateWorkerSchedule = readFileSync(new URL("../api/worker-sweep.ts", import.meta.url), "utf8");
const packageConfig = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const vercelConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("each persisted workflow step receives a stable per-job idempotency key", () => {
  assert.match(nodeTypes, /idempotencyKey\?: string/);
  assert.match(nodeTypes, /getIdempotencyKey\?: \(stepId: string\) => string/);
  assert.match(runner, /idempotencyKey: args\.context\.getIdempotencyKey\?\.\(checkpointStep\.id\)/);
  assert.match(worker, /getIdempotencyKey: \(stepId: string\) => `rexnora:\$\{job\.id\}:\$\{stepId\}`/);
});

test("Resend sends use the stable Idempotency-Key and distinguish transient from permanent errors", () => {
  assert.match(email, /"Idempotency-Key": ctx\.idempotencyKey/);
  assert.match(email, /EMAIL_PROVIDER_TRANSIENT_FAILURE/);
  assert.match(email, /EMAIL_IDEMPOTENCY_IN_PROGRESS/);
  assert.match(email, /EMAIL_PROVIDER_REJECTED/);
  assert.match(email, /ctx\.signal\?\.aborted/);
});

test("live retries are restricted to the explicit safe-operation allowlist", () => {
  assert.match(worker, /const RETRY_SAFE_LIVE_OPERATIONS = new Set/);
  assert.match(worker, /step\.nodeId === "email" && step\.operationId === "send_email"/);
  assert.match(worker, /return steps\.every\(\(step\) => step\.kind === "trigger" \|\|/);
  assert.match(dispatch, /durableLiveRetryAttempts\(registrySteps\)/);
  assert.match(webhook, /durableLiveRetryAttempts\(steps\)/);
});

test("worker performs a bounded retry wake rather than unbounded polling", () => {
  assert.match(worker, /for \(let pass = 0; pass < 25 && Date\.now\(\) < deadline; pass\+\+\)/);
  assert.match(worker, /setTimeout\(resolve, 10_000\)/);
});

test("database retry classification and Resend idempotency window fail closed", () => {
  assert.match(migration, /EMAIL_RATE_LIMITED/);
  assert.match(migration, /EMAIL_PROVIDER_TRANSIENT_FAILURE/);
  assert.match(migration, /EMAIL_IDEMPOTENCY_IN_PROGRESS/);
  assert.match(migration, /or not retryable/);
  assert.match(migration, /interval '20 hours'/);
  assert.match(migration, /least\(p_max_attempts, 3\)/);
});

test("expired leased jobs with a cancellation request are cancelled, never reclaimed", () => {
  assert.match(migration, /status = 'running' and lease_until < now\(\)[\s\S]*?cancel_requested_at is not null/);
  assert.match(migration, /status = 'cancelled'[\s\S]*?last_error_code = 'EXECUTION_CANCELLED'/);
  assert.match(migration, /where j\.cancel_requested_at is null/);
});

test("scheduled worker recovery is recurring and environment-gated", () => {
  assert.equal(vercelConfig.schedules["workflow-scheduler-tick"].schedule, "*/30 * * * *");
  assert.equal(vercelConfig.schedules["workflow-scheduler-tick"].path, "/api/internal/scheduler");
  assert.equal(vercelConfig.schedules["durable-worker-recovery"].schedule, "*/30 * * * *");
  assert.equal(vercelConfig.schedules["durable-worker-recovery"].function, "api/worker-sweep");
  assert.equal(vercelConfig.functions["api/worker-sweep.ts"].experimentalTriggers[0].type, "schedule/v1beta");
  assert.match(privateWorkerSchedule, /AIVANTA_DURABLE_WORKER_SCHEDULE_ENABLED !== "true"/);
  assert.match(privateWorkerSchedule, /handleSchedule/);
  assert.match(privateWorkerSchedule, /export const POST/);
  assert.match(privateWorkerSchedule, /runDurableWorker\(\)/);
  assert.equal(packageConfig.dependencies["@vercel/schedules"], "0.0.3");
});
