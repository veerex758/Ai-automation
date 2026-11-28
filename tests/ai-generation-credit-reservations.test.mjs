import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const [migration, route, builder, playbook, safeLog] = await Promise.all([
  read("supabase/migrations/20261128130000_rexnora_ai_generation_credit_reservations.sql"),
  read("app/api/ai/generate-workflow/route.ts"),
  read("app/dashboard/workflows/[workflowId]/page.tsx"),
  read("app/dashboard/playbooks/new/page.tsx"),
  read("lib/observability/safe-log.cjs"),
]);

test("credit reservations are private, workspace-scoped, and unavailable to browser table access", () => {
  assert.match(migration, /create table if not exists private\.ai_generation_credit_reservations/);
  assert.match(migration, /primary key \(workspace_id, operation_id\)/);
  assert.match(migration, /alter table private\.ai_generation_credit_reservations enable row level security/);
  assert.match(migration, /revoke all on private\.ai_generation_credit_reservations from public, anon, authenticated, service_role/);
  assert.match(migration, /revoke all on private\.ai_provider_usage_events from public, anon, authenticated, service_role/);
  assert.ok(migration.includes("p_request_fingerprint !~ '^[0-9a-f]{64}$'"));
});

test("reserve is quota-authoritative, idempotent, and not a customer usage insert", () => {
  const reserveStart = migration.indexOf("create or replace function public.reserve_ai_generation_usage");
  const reserveEnd = migration.indexOf("revoke all on function public.reserve_ai_generation_usage", reserveStart);
  const reserveBody = migration.slice(reserveStart, reserveEnd);
  assert.ok(reserveStart >= 0 && reserveEnd > reserveStart);
  assert.match(reserveBody, /pg_advisory_xact_lock/);
  assert.match(reserveBody, /for update/);
  assert.match(reserveBody, /operation_in_progress/);
  assert.match(reserveBody, /already_consumed/);
  assert.match(reserveBody, /request_fingerprint <> p_request_fingerprint/);
  assert.match(reserveBody, /v_ai \+ v_reserved \+ 1 > v_limit/);
  assert.match(reserveBody, /insert into private\.ai_generation_credit_reservations/);
  assert.doesNotMatch(reserveBody, /insert into public\.workspace_usage/);
});

test("release is idempotent and never reverses a completed consumption", () => {
  const releaseStart = migration.indexOf("create or replace function public.release_ai_generation_usage");
  const releaseEnd = migration.indexOf("revoke all on function public.release_ai_generation_usage", releaseStart);
  const releaseBody = migration.slice(releaseStart, releaseEnd);
  assert.ok(releaseStart >= 0 && releaseEnd > releaseStart);
  assert.match(releaseBody, /status = 'consumed'/);
  assert.match(releaseBody, /already_consumed/);
  assert.match(releaseBody, /already_released/);
  assert.match(releaseBody, /status = 'released'/);
  assert.match(releaseBody, /private\.record_ai_provider_usage_events/);
  assert.doesNotMatch(releaseBody, /delete from public\.workspace_usage|update public\.workspace_usage/);
});

test("settlement atomically inserts one credit, one generation and actual provider usage", () => {
  const consumeStart = migration.indexOf("create function public.consume_ai_generation_usage");
  const consumeEnd = migration.indexOf("revoke all on function public.consume_ai_generation_usage", consumeStart);
  const consumeBody = migration.slice(consumeStart, consumeEnd);
  assert.ok(consumeStart >= 0 && consumeEnd > consumeStart);
  assert.match(consumeBody, /v_reservation\.status = 'consumed'/);
  assert.match(consumeBody, /'duplicate', true/);
  assert.match(consumeBody, /insert into public\.workspace_usage/);
  assert.match(consumeBody, /v_period := v_reservation\.period_start/);
  assert.match(consumeBody, /'ai_generation'/);
  assert.match(consumeBody, /'ai_credit'/);
  assert.match(consumeBody, /insert into private\.ai_provider_usage_events/);
  assert.match(consumeBody, /p_provider_usage/);
  assert.match(consumeBody, /provider_cost_usd/);
  assert.match(consumeBody, /update private\.ai_generation_credit_reservations/);
  assert.match(consumeBody, /metadata.*idempotency_key/s);
});

test("all workspace AI spend paths account for outstanding reservations", () => {
  const genericStart = migration.indexOf("create or replace function public.consume_workspace_usage");
  const genericEnd = migration.indexOf("revoke all on function public.consume_workspace_usage", genericStart);
  const genericBody = migration.slice(genericStart, genericEnd);
  const agentStart = migration.indexOf("create or replace function public.consume_agent_run_usage");
  const agentEnd = migration.indexOf("revoke all on function public.consume_agent_run_usage", agentStart);
  const agentBody = migration.slice(agentStart, agentEnd);
  assert.match(genericBody, /ai_generation_credit_reservations/);
  assert.match(genericBody, /v_used \+ p_quantity \+ v_reserved > v_limit/);
  assert.match(agentBody, /ai_generation_credit_reservations/);
  assert.match(agentBody, /v_credits \+ v_reserved \+ 1 > v_limit/);
});

test("provider failures release reservations while the credit settlement remains after graph validation", () => {
  const reserve = route.indexOf('supabase.rpc("reserve_ai_generation_usage"');
  const generation = route.indexOf("await generateWorkflow(");
  const validation = route.indexOf("validateRegisteredSteps(rebuilt)");
  const consume = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  const finallyBlock = route.lastIndexOf("} finally");
  const releaseRpc = route.indexOf('supabase.rpc("release_ai_generation_usage"');
  const releaseFinally = route.indexOf("await releaseReservation();", finallyBlock);
  assert.ok(reserve > 0 && generation > reserve && validation > generation && consume > validation);
  assert.ok(releaseRpc > reserve && releaseRpc < consume);
  assert.ok(finallyBlock > consume && releaseFinally > finallyBlock);
  assert.match(route, /if \(releaseReservation && !reservationConsumed\)/);
  assert.equal((route.match(/consume_ai_generation_usage/g) || []).length, 1);
  assert.match(route, /p_provider_usage: Array\.from\(providerUsageByModel\.values\(\)\)/);
  assert.match(migration, /expires_at timestamptz not null default now\(\) \+ interval '10 minutes'/);
});

test("workflow canvas sends and reuses the same idempotency key on explicit retry", () => {
  assert.match(builder, /aiDraftOperationId/);
  assert.match(builder, /const operationId = retryOperationId \?\? window\.crypto\.randomUUID\(\)/);
  assert.match(builder, /"Idempotency-Key": operationId/);
  assert.match(builder, /generateDraftOnCanvas\(aiDraftRetryPrompt, aiDraftOperationId\)/);
  assert.match(builder, /setAiDraftOperationId\(""/);
});

test("Playbook generation sends and reuses the same idempotency key on explicit retry", () => {
  assert.match(playbook, /operationId: string/);
  assert.match(playbook, /const operationId = retryOperationId \?\? window\.crypto\.randomUUID\(\)/);
  assert.match(playbook, /"Idempotency-Key": operationId/);
  assert.match(playbook, /generateDraft\(retryRequest\.prompt, retryRequest\.crmProvider, retryRequest\.operationId\)/);
});

test("logical operation IDs are retained in safe logs without exposing customer input", () => {
  assert.match(safeLog, /"operationId"/);
  assert.match(safeLog, /record\.operationId = value/);
  assert.match(route, /operationId, route: "\/api\/ai\/generate-workflow"/);
  assert.match(safeLog, /SAFE_REQUEST_ID\.test\(value\)/);
});
