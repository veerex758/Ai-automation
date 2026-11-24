import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const pipeline = read("../lib/real-estate/pipeline.ts");
const migration = read("../supabase/migrations/20261120104000_real_estate_pipeline_delivery.sql");
const intake = read("../app/api/real-estate/intake/[publicKey]/route.ts");
const manualLead = read("../app/api/real-estate/leads/route.ts");
const serviceClient = read("../lib/real-estate/server.ts");
const followups = read("../lib/real-estate/followups.ts");
const followupsRoute = read("../app/api/cron/real-estate-followups/route.ts");
const pipelineWorker = read("../app/api/cron/real-estate-pipeline/route.ts");
const emailNode = read("../nodes/email.ts");

test("real-estate service client skips empty Supabase placeholders and falls back to integration keys", () => {
  assert.match(
    serviceClient,
    /const key = process\.env\.SUPABASE_SECRET_KEY \|\| process\.env\.SUPABASE_SERVICE_ROLE_KEY \|\|\s*process\.env\.CODED_SUPABASE_SERVICE_ROLE_KEY \|\| process\.env\.CODED_SUPABASE_SECRET_KEY;/
  );
});

test("lead pipeline requires a tested workspace connection and an operation-specific approval", () => {
  assert.match(pipeline, /status !== "connected"/);
  assert.match(pipeline, /last_test_status !== "passed"/);
  assert.match(pipeline, /approval\?\.decision !== "approved"/);
  assert.match(pipeline, /workspace_provider_operation_approvals/);
  assert.match(pipeline, /workspace_integration_secrets/);
  assert.match(pipeline, /decryptWorkspaceCredentials/);
});

test("Playbook execution uses the exact provider account selected and checked at activation", () => {
  assert.match(pipeline, /selectedConnectionId/);
  assert.match(pipeline, /integrationQuery = integrationQuery\.eq\("id", selectedConnectionId\)/);
  assert.match(pipeline, /requireSelectedConnection && !selectedConnectionId/);
  assert.match(pipeline, /geminiStep\?\.connectionId/);
  assert.match(pipeline, /emailStep\?\.connectionId/);
  assert.match(pipeline, /runtime\.mode === "playbook"/);
});

test("Gemini qualification receives no direct contact identifiers and redacts contact details in free text", () => {
  const start = pipeline.indexOf("function qualificationInput(");
  const end = pipeline.indexOf("\nfunction mergeQualification(", start);
  const helper = pipeline.slice(start, end);
  const payload = helper.slice(helper.indexOf("return JSON.stringify({"));
  assert.doesNotMatch(payload, /lead\.full_name|lead\.email|lead\.phone/);
  assert.match(helper, /redacted email/);
  assert.match(helper, /redacted phone/);
  assert.match(helper, /redacted name/);
  const gemini = read("../nodes/gemini.ts");
  assert.doesNotMatch(gemini, /fullName: z\.string|email: z\.string|phone: z\.string/);
  assert.doesNotMatch(gemini, /fullName: \{ type: "STRING"|email: \{ type: "STRING"|phone: \{ type: "STRING"/);
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

test("real-estate template gallery exposes four distinct automation setup paths", () => {
  const gallery = read("../app/dashboard/section-page.tsx");
  const playbookSetup = read("../app/dashboard/playbooks/new/page.tsx");
  const realEstatePage = read("../app/dashboard/real-estate/page.tsx");
  for (const [name, href] of [
    ["Instant Speed-to-Lead & Qualification", "#speed-to-lead"],
    ["Property Inspection & Calendar Booking", "#inspection-booking"],
    ["90-Day Buyer & Investor Follow-Up", "/dashboard/real-estate#followups"],
    ["Real Estate Back-Office Automation", "#back-office"],
  ]) {
    assert.ok(gallery.includes(name), "missing template " + name);
    assert.ok(gallery.includes(href), "missing template destination " + href);
  }
  assert.match(playbookSetup, /whatsapp_business\.send_template/);
  assert.match(playbookSetup, /google_calendar\.create_event/);
  assert.match(playbookSetup, /exact match before creating a contact/);
  assert.match(realEstatePage, /window\.location\.hash==="#followups"/);
});

test("real-estate nurture is spread across 90 days using the existing five-step queue", () => {
  const scoring = read("../lib/real-estate/lead-scoring.ts");
  assert.match(scoring, /sequence: 1, ms: 0, delayLabel: "Immediately"/);
  assert.match(scoring, /sequence: 2, ms: 1 \* 24 \* 60 \* 60 \* 1000, delayLabel: "1 day"/);
  assert.match(scoring, /sequence: 3, ms: 7 \* 24 \* 60 \* 60 \* 1000, delayLabel: "7 days"/);
  assert.match(scoring, /sequence: 4, ms: 30 \* 24 \* 60 \* 60 \* 1000, delayLabel: "30 days"/);
  assert.match(scoring, /sequence: 5, ms: 90 \* 24 \* 60 \* 60 \* 1000, delayLabel: "90 days"/);
  assert.match(read("../app/dashboard/real-estate/page.tsx"), /"Immediately","1 day","7 days","30 days","90 days"/);
});

test("AI follow-up drafts are persisted only for email leads with recorded consent", () => {
  assert.match(pipeline, /!lead\.consent_to_contact \|\| lead\.contact_preference !== "email" \|\| !lead\.email/);
  assert.match(pipeline, /qualification\.followupMessages\[index\]/);
  assert.match(pipeline, /eq\("status", "pending"\)/);
});

test("agent alerts use an explicit agency allowlist and stable recipient idempotency", () => {
  assert.match(pipeline, /real_estate_notification_recipients/);
  assert.match(pipeline, /eq\("active", true\)/);
  assert.match(pipeline, /AGENCY_NOTIFICATION_RECIPIENT_NOT_APPROVED/);
  assert.match(pipeline, /real-estate-agent-alert:/);
  assert.match(pipeline, /agent_notification_accepted_recipient_hashes/);
  assert.match(migration, /agent_notification_accepted_recipient_hashes jsonb/i);
});

test("follow-up delivery goes through the registered Resend operation with a stable idempotency key", () => {
  assert.match(followups, /findOperation\("email", "send_email", "action"\)/);
  assert.match(followups, /idempotencyKey: "real-estate-followup:"/);
  assert.doesNotMatch(followups, /fetch\("https:\/\/api\.resend\.com\/emails"/);
  assert.match(emailNode, /EMAIL_PROVIDER_UNAVAILABLE/);
});

test("manual real-estate lead records the selected contact channel in its consent text", () => {
  assert.match(read("../app/dashboard/real-estate/page.tsx"), /Customer explicitly agreed to follow-up contact by "\+leadForm\.contactPreference/);
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

test("duplicate public intake acknowledgements do not disclose an existing lead profile", () => {
  const start = intake.indexOf("if(prior){");
  const end = intake.indexOf("\n  const budgetMin", start);
  const duplicateBranch = intake.slice(start, end);
  assert.match(duplicateBranch, /return NextResponse\.json\(\{accepted:true,duplicate:true\}/);
  assert.doesNotMatch(duplicateBranch, /full_name:prior\.full_name|lead_score:prior\.lead_score|lead_temperature:prior\.lead_temperature|pipeline\},\{status:200/);
});

test("both public-form and manual leads bind to the exact active Playbook version", () => {
  for (const route of [intake, manualLead]) {
    assert.match(route, /\.eq\("status",\s*"active"\)/);
    assert.match(route, /schema:\s*"rexnora\.playbook"/);
    assert.match(route, /workflow_id:\s*activePlaybook\?\.id\s*\?\?\s*null/);
    assert.match(route, /playbook_version:\s*activePlaybook\?\.version\s*\?\?\s*null/);
  }
});

