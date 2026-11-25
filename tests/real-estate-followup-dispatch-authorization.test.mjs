import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const followups = read("../lib/real-estate/followups.ts");
const migration = read("../supabase/migrations/20261125130000_rexnora_atomic_followup_dispatch.sql");
const hardening = read("../supabase/migrations/20261125140000_rexnora_atomic_followup_dispatch_hardening.sql");

test("follow-up sends require database authorization immediately before provider dispatch", () => {
  const authorization = followups.indexOf('"authorize_real_estate_followup_dispatch"');
  const providerSend = followups.indexOf("await operation.run(context, {");
  assert.ok(authorization >= 0);
  assert.ok(providerSend > authorization);
  assert.match(followups, /dispatchAuthorized !== true/);
  assert.match(followups, /FOLLOWUP_DISPATCH_AUTHORIZATION_FAILED/);
});

test("database authorization locks the lead and leased follow-up and checks current consent", () => {
  assert.match(migration, /for update of l/i);
  assert.match(migration, /for update;/i);
  assert.match(migration, /lease_token is distinct from p_lease_token/i);
  assert.match(migration, /lease_until <= now\(\)/i);
  assert.match(migration, /consent_to_contact is distinct from true/i);
  assert.match(migration, /consent_at is null/i);
  assert.match(migration, /consent_text is null/i);
  assert.match(migration, /customer_responded_at is not null/i);
  assert.match(migration, /agent_takeover_at is not null/i);
});

test("authorization is service-role-only and records an idempotent consent snapshot", () => {
  assert.match(migration, /unique \(followup_id, lease_token\)/i);
  assert.match(migration, /dispatch_consent_at/);
  assert.match(migration, /dispatch_consent_text/);
  assert.match(migration, /to service_role/i);
  assert.match(migration, /from public, anon, authenticated/i);
});

test("stop conditions cancel pending and currently leased follow-ups", () => {
  assert.match(migration, /status in \('pending','sending'\)/i);
  assert.match(migration, /lease_token=null/i);
});

test("final authorization binds the workspace, lease and exact recipient email", () => {
  assert.match(followups, /p_workspace_id: claim\.workspace_id/);
  assert.match(followups, /p_followup_id: claim\.id/);
  assert.match(followups, /p_lease_token: claim\.lease_token/);
  assert.match(followups, /p_expected_email: lead\.email/);
  assert.match(hardening, /p_expected_email text/);
  assert.match(hardening, /lower\(pg_catalog\.btrim\(current_lead\.email\)\) <> lower\(pg_catalog\.btrim\(p_expected_email\)\)/);
});

test("consent withdrawal stops un-authorized sends but does not rewrite an already-authorized external request", () => {
  assert.match(hardening, /status in \('pending','sending'\)[\s\S]*status = 'pending' or dispatch_authorized_at is null/);
  assert.match(hardening, /dispatch_authorized_at = null/);
  assert.match(hardening, /dispatch_consent_at = null/);
  assert.match(hardening, /dispatch_consent_text = null/);
});
