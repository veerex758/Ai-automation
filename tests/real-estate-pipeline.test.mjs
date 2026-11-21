import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const pipeline = read("../lib/real-estate/pipeline.ts");
const migration = read("../supabase/migrations/20261120104000_real_estate_pipeline_delivery.sql");
const intake = read("../app/api/real-estate/intake/[publicKey]/route.ts");
const manualLead = read("../app/api/real-estate/leads/route.ts");
const followups = read("../lib/real-estate/followups.ts");
const followupsRoute = read("../app/api/cron/real-estate-followups/route.ts");
const pipelineWorker = read("../app/api/cron/real-estate-pipeline/route.ts");
const emailNode = read("../nodes/email.ts");

test("lead pipeline requires a tested workspace connection and an operation-specific approval", () => {
  assert.match(pipeline, /status !== "connected"/);
  assert.match(pipeline, /last_test_status !== "passed"/);
  assert.match(pipeline, /approval\?\.decision !== "approved"/);
  assert.match(pipeline, /workspace_provider_operation_approvals/);
  assert.match(pipeline, /workspace_integration_secrets/);
  assert.match(pipeline, /decryptWorkspaceCredentials/);
});

test("lead qualification and notification use existing registered node operations", () => {
  assert.match(pipeline, /findOperation\("gemini", "qualify_real_estate_lead", "action"\)/);
  assert.match(pipeline, /findOperation\("email", "send_email", "action"\)/);
  assert.match(pipeline, /getWorkerOperationMapping/);
  assert.match(emailNode, /idempotencyKey/);
  assert.match(emailNode, /"Idempotency-Key"/);
});

test("pipeline claims are workspace-scoped and recover expired worker leases", () => {
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /pipeline_lease_until <= now\(\)/i);
  assert.match(migration, /p_workspace_id uuid default null/i);
  assert.match(pipeline, /claim_due_real_estate_lead_pipeline/);
  assert.match(pipeline, /p_workspace_id: options\.workspaceId/);
  assert.match(pipeline, /pipeline_lease_token/);
});

test("numeric scores are calculated by the deterministic scorer, not Gemini temperature", () => {
  assert.match(pipeline, /scoreRealEstateLead\(/);
  assert.match(pipeline, /lead_score: score\.score/);
  assert.match(pipeline, /lead_temperature: score\.temperature/);
  assert.doesNotMatch(pipeline, /qualification\.temperature\s*\)/);
  assert.doesNotMatch(pipeline, /lead_score:\s*qualification\.temperature/);
});

test("AI follow-up drafts are persisted only for email leads with recorded consent", () => {
  assert.match(pipeline, /!lead\.consent_to_contact \|\| lead\.contact_preference !== "email" \|\| !lead\.email/);
  assert.match(pipeline, /qualification\.followupMessages\[index\]/);
  assert.match(pipeline, /eq\("status", "pending"\)/);
});

test("agent alerts use stable recipient idempotency and preserve accepted recipients across retries", () => {
  assert.match(pipeline, /real-estate-agent-alert:/);
  assert.match(pipeline, /agent_notification_accepted_recipient_hashes/);
  assert.match(migration, /agent_notification_accepted_recipient_hashes jsonb/i);
  assert.match(pipeline, /auth\.admin\.getUserById/);
});

test("public and authenticated lead creation trigger the durable pipeline and repair duplicate side effects", () => {
  assert.match(intake, /processRealEstateLeadPipeline/);
  assert.match(intake, /ensurePublicLeadSideEffects/);
  assert.match(manualLead, /processRealEstateLeadPipeline/);
  assert.match(manualLead, /ensureLeadSideEffects/);
});

test("scheduled workers are authenticated and remain behind explicit live-execution switches", () => {
  assert.match(pipelineWorker, /timingSafeEqual/);
  assert.match(pipelineWorker, /REAL_ESTATE_PIPELINE_ENABLED/);
  assert.match(pipelineWorker, /AIVANTA_LIVE_EXECUTION_ENABLED/);
  assert.match(followupsRoute, /timingSafeEqual/);
  assert.match(followupsRoute, /processDueRealEstateFollowups/);
  assert.match(followups, /REAL_ESTATE_FOLLOWUPS_ENABLED/);
  assert.match(followups, /AIVANTA_LIVE_EXECUTION_ENABLED/);
});
