import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../app/api/workflows/[workflowId]/live-run/route.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../supabase/migrations/20261010201327_aivanta_live_email_runs.sql", import.meta.url),
  "utf8",
);
const provider = readFileSync(
  new URL("../lib/integrations/resend.cjs", import.meta.url),
  "utf8",
);

test("requires a UUID idempotency key before attempting a live run", () => {
  assert.match(route, /request\.headers\.get\(["']idempotency-key["']\)/i);
  assert.match(route, /if\s*\(!uuidPattern\.test\(idempotencyKey\)\)/i);
  assert.match(route, /UUID Idempotency-Key header is required/i);
});

test("scopes duplicate lookup to the authenticated actor and workflow", () => {
  const lookupStart = route.indexOf('const { data: priorRun');
  assert.notEqual(lookupStart, -1);
  const lookupEnd = route.indexOf("if (priorRunError)", lookupStart);
  assert.notEqual(lookupEnd, -1);
  const lookup = route.slice(lookupStart, lookupEnd);

  assert.match(lookup, /\.eq\(["']idempotency_key["'],\s*idempotencyKey\)/);
  assert.match(lookup, /\.eq\(["']created_by["'],\s*user\.id\)/);
  assert.match(lookup, /\.eq\(["']workflow_id["'],\s*workflowId\)/);
});

test("returns an existing run before reaching the provider call", () => {
  const duplicateCheck = route.indexOf("if (priorRun) return NextResponse.json");
  const providerCall = route.indexOf("await sendResendEmail(");
  assert.ok(duplicateCheck >= 0, "existing run must be detected");
  assert.ok(providerCall > duplicateCheck, "duplicate response must happen before provider invocation");
  assert.match(route.slice(duplicateCheck, providerCall), /duplicate:\s*true/);
  assert.match(route.slice(duplicateCheck, providerCall), /No second email was sent/i);
});

test("handles concurrent unique-key collisions without a second provider call", () => {
  const collision = route.indexOf('if (insertError?.code === "23505")');
  const providerCall = route.indexOf("await sendResendEmail(");
  assert.ok(collision >= 0, "unique-index collision must be handled");
  assert.ok(providerCall > collision, "collision branch must precede provider invocation");

  const collisionBlock = route.slice(collision, providerCall);
  assert.match(collisionBlock, /\.eq\(["']idempotency_key["'],\s*idempotencyKey\)/);
  assert.match(collisionBlock, /\.eq\(["']created_by["'],\s*user\.id\)/);
  assert.match(collisionBlock, /\.eq\(["']workflow_id["'],\s*workflowId\)/);
  assert.match(collisionBlock, /duplicate:\s*true/);
  assert.match(collisionBlock, /status:\s*409/);
});

test("persists a unique idempotency key and forwards a stable run key to the provider", () => {
  assert.match(migration, /create unique index if not exists workflow_runs_idempotency_key_uidx/i);
  assert.match(migration, /on public\.workflow_runs\s*\(idempotency_key\)/i);
  assert.match(route, /idempotency_key:\s*idempotencyKey/);
  assert.match(route, /sendResendEmail\([\s\S]*?\{\s*idempotencyKey:\s*run\.id\s*\}\)/);
  assert.match(provider, /["']Idempotency-Key["']:\s*options\.idempotencyKey/);
});

test("does not recommend retrying when run-result persistence fails after a possible side effect", () => {
  assert.match(route, /An external email may already have been accepted/i);
  assert.match(route, /retrySafe:\s*false/);
  assert.match(route, /Do not retry the provider call/i);
});
