import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const pipeline = read("../lib/real-estate/pipeline.ts");
const migration = read("../supabase/migrations/20261120104000_real_estate_pipeline_delivery.sql");
const pilotMigration = read("../supabase/migrations/20261124170000_rexnora_real_estate_crm_and_whatsapp_retries.sql");
const playbookDefinition = read("../lib/playbooks/definition.cjs");
const intake = read("../app/api/real-estate/intake/[publicKey]/route.ts");
const manualLead = read("../app/api/real-estate/leads/route.ts");
const serviceClient = read("../lib/real-estate/server.ts");
const followups = read("../lib/real-estate/followups.ts");
const realEstatePage = read("../app/dashboard/real-estate/page.tsx");
const playbookPage = read("../app/dashboard/playbooks/new/page.tsx");
const sectionPage = read("../app/dashboard/section-page.tsx");
const inspectionRequest = read("../app/api/real-estate/inspections/route.ts");
const inspectionApproval = read("../app/api/real-estate/inspections/[bookingId]/approve/route.ts");
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

test("AI follow-up drafts are persisted only for email leads with recorded consent", () => {
  assert.match(pipeline, /!lead\.consent_to_contact \|\| !lead\.consent_at \|\| !lead\.consent_text \|\| lead\.contact_preference !== "email" \|\| !lead\.email/);
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

test("public and authenticated lead creation trigger the durable pipeline and repair duplicate side effects", () => {
  assert.match(intake, /processRealEstateLeadPipeline/);
  assert.match(intake, /ensurePublicLeadSideEffects/);
  assert.match(manualLead, /processRealEstateLeadPipeline/);
  assert.match(manualLead, /ensureLeadSideEffects/);
});

test("both public-form and manual leads bind to the exact active Playbook version", () => {
  for (const route of [intake, manualLead]) {
    assert.match(route, /\.eq\("status",\s*"active"\)/);
    assert.match(route, /schema:\s*"rexnora\.playbook"/);
    assert.match(route, /workflow_id:\s*activePlaybook\?\.id\s*\?\?\s*null/);
    assert.match(route, /playbook_version:\s*activePlaybook\?\.version\s*\?\?\s*null/);
  }
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


test("WhatsApp live dispatch requires channel-specific consent, an approved template and a durable no-blind-resend ledger", () => {
  assert.match(playbookDefinition, /whatsapp_business.*send_template/);
  assert.match(pipeline, /isProviderLiveEnabled\("whatsapp_business"/);
  assert.match(pipeline, /!\/whatsapp\/i\.test\(lead\.consent_text\)/);
  assert.match(pipeline, /contact_preference !== "whatsapp"/);
  assert.match(pipeline, /real_estate_channel_deliveries/);
  assert.match(pipeline, /existing\?\.status === "unknown" \|\| existing\?\.status === "sending"/);
  assert.match(pipeline, /RATE_LIMITED/);
  assert.match(pilotMigration, /attempt_count smallint not null default 0/);
});

test("CRM sync searches exact email before creating and stops on uncertain or ambiguous outcomes", () => {
  const searchIndex = pipeline.indexOf("searchOperation.run(");
  const createIndex = pipeline.indexOf("createOperation.run(");
  assert.ok(searchIndex > 0 && createIndex > searchIndex);
  assert.match(playbookDefinition, /pipedrive.*search_contacts.*execute/);
  assert.match(playbookDefinition, /zoho_crm.*search_contacts.*execute/);
  assert.match(playbookDefinition, /freshsales.*search_contacts.*execute/);
  assert.match(pipeline, /CRM_SEARCH_RESULT_NEEDS_REVIEW/);
  assert.match(pipeline, /prior && \["unknown", "creating"\]\.includes\(prior\.status\)/);
  assert.match(pipeline, /real_estate_crm_syncs/);
  assert.match(pilotMigration, /create table if not exists public\.real_estate_crm_syncs/);
});

test("back-office task and CRM/WhatsApp outcomes are recorded with durable pipeline side effects", () => {
  assert.match(pipeline, /ensureBackOfficeTask\(db, lead\)/);
  assert.match(pipeline, /lead\.back_office_task_created/);
  assert.match(pipeline, /lead\.crm_contact_created/);
  assert.match(pipeline, /lead\.whatsapp_template_accepted/);
  assert.match(pipeline, /status: "accepted"/);
});

test("follow-up worker rechecks timestamped consent before every customer email", () => {
  assert.match(followups, /consent_text,consent_at/);
  assert.match(followups, /!lead\.consent_at \|\| !lead\.consent_text/);
});


test("public and manual intake require recorded channel consent before creating follow-up work", () => {
  const enumIndex = intake.indexOf("const enumValue=");
  const preferenceIndex = intake.indexOf("const contactPreference=enumValue");
  assert.ok(enumIndex >= 0 && preferenceIndex > enumIndex);
  assert.match(intake, /contactPreference==="whatsapp" && !\/whatsapp\/i\.test\(consentText\)/);
  assert.match(intake, /!lead\.consent_at\|\|!lead\.consent_text/);
  assert.match(manualLead, /contactPreference === "whatsapp" && !\/whatsapp\/i\.test\(consentText\)/);
  assert.match(manualLead, /!lead\.consent_at \|\| !lead\.consent_text/);
});

test("Playbook policy validation evaluates all IF rules before CRM writes", () => {
  assert.match(playbookDefinition, /\.{3}\s*crmActions/);
  assert.match(playbookDefinition, /Every deterministic Playbook rule must be evaluated before customer communication or CRM writes/);
});


test("all four real-estate starter cards route to the dedicated runtime workflows", () => {
  assert.match(sectionPage, /name:"Instant Speed-to-Lead & Qualification"/);
  assert.match(sectionPage, /href:"\\/dashboard\\/playbooks\\/new#speed-to-lead"/);
  assert.match(sectionPage, /name:"Property Inspection & Calendar Booking"/);
  assert.match(sectionPage, /href:"\\/dashboard\\/real-estate\\/operations"/);
  assert.match(sectionPage, /name:"90-Day Buyer & Investor Follow-Up"/);
  assert.match(sectionPage, /href:"\\/dashboard\\/real-estate#followups"/);
  assert.match(sectionPage, /name:"Real Estate Back-Office Automation"/);
  assert.match(sectionPage, /href:"\\/dashboard\\/real-estate\\/operations#tasks"/);
});

test("inspection booking separates availability and reservation from owner-approved Calendar writes", () => {
  assert.match(inspectionRequest, /operations\\.manage/);
  assert.match(inspectionRequest, /workspace_provider_operation_approvals/);
  assert.match(inspectionRequest, /operationApproved\\(db, workspace\\.id, "execute"\\)/);
  assert.match(inspectionRequest, /findOperation\\("google_calendar", "execute", "action"\\)/);
  assert.match(inspectionRequest, /reserve_real_estate_inspection_booking/);
  assert.match(inspectionRequest, /customerInviteEmail/);
  assert.doesNotMatch(inspectionRequest, /findOperation\\("google_calendar", "create_event"/);

  assert.match(inspectionApproval, /workspaceRow\\?\\.owner_id !== user\\.id/);
  assert.match(inspectionApproval, /"owner", "admin"/);
  assert.match(inspectionApproval, /operation_id", "create_event"/);
  assert.match(inspectionApproval, /begin_real_estate_inspection_booking/);
  assert.match(inspectionApproval, /findOperation\\("google_calendar", "create_event", "action"\\)/);
  assert.match(inspectionApproval, /booking\\.id\\.replaceAll/);
});

test("manual lead UI records the customer's actual words and never synthesizes channel consent", () => {
  assert.match(realEstatePage, /consentText:""/);
  assert.match(realEstatePage, /leadForm\.consentText\.trim\(\)/);
  assert.match(realEstatePage, /Record the customer’s actual consent wording/);
  assert.match(realEstatePage, /For WhatsApp, the wording must explicitly mention WhatsApp/);
  assert.doesNotMatch(realEstatePage, /Customer explicitly agreed to follow-up contact by/);
});

test("real-estate starter requires the complete configured action bundle and one selected CRM", () => {
  assert.match(playbookPage, /useState<"pipedrive" \| "zoho_crm" \| "freshsales">\("pipedrive"\)/);
  assert.match(playbookPage, /hasStep\("gemini", "qualify_real_estate_lead", "action"\)/);
  assert.match(playbookPage, /hasStep\("if", "evaluate", "action"\)/);
  assert.match(playbookPage, /hasStep\("email", "send_email", "action"\)/);
  assert.match(playbookPage, /hasStep\("whatsapp_business", "send_template", "action"\)/);
  assert.match(playbookPage, /crmSteps\.length !== 2/);
  assert.match(playbookPage, /crmCreateIndex <= crmSearchIndex/);
  assert.match(playbookPage, /No draft was saved; generate it again/);
  assert.match(playbookPage, /Create full starter draft/);
  assert.match(playbookPage, /never activate or execute anything/i);
});
