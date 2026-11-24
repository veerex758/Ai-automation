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
const playbookDefinition = read("../lib/playbooks/definition.cjs");
const durableWorker = read("../lib/workflows/durable-worker.ts");
const inspectionRoute = read("../app/api/real-estate/inspections/route.ts");
const inspectionApprovalRoute = read("../app/api/real-estate/inspections/[bookingId]/approve/route.ts");
const tasksRoute = read("../app/api/real-estate/tasks/route.ts");
const taskItemRoute = read("../app/api/real-estate/tasks/[taskId]/route.ts");
const operationsPage = read("../app/dashboard/real-estate/operations/page.tsx");
const channelMigration = read("../supabase/migrations/20261124125757_rexnora_real_estate_channels_inspections_tasks.sql");

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
    ["Property Inspection & Calendar Booking", "/dashboard/real-estate/operations"],
    ["90-Day Buyer & Investor Follow-Up", "/dashboard/real-estate#followups"],
    ["Real Estate Back-Office Automation", "/dashboard/real-estate/operations#tasks"],
  ]) {
    assert.ok(gallery.includes(name), "missing template " + name);
    assert.ok(gallery.includes(href), "missing template destination " + href);
  }
  assert.match(playbookSetup, /whatsapp_business\.send_template/);
  assert.match(playbookSetup, /google_calendar\.create_event/);
  assert.match(playbookSetup, /exact match before creating a contact/);
  assert.match(realEstatePage, /window\.location\.hash==="#followups"/);
});

test("WhatsApp delivery requires exact channel consent and a durable no-resend ledger", () => {
  assert.ok(pipeline.includes('lead.consent_to_contact === true'));
  assert.ok(pipeline.includes('lead.contact_preference === "whatsapp"'));
  assert.ok(pipeline.includes("WHATSAPP_CHANNEL_CONSENT_REQUIRED"));
  assert.ok(pipeline.includes("real_estate_channel_deliveries"));
  assert.ok(pipeline.includes('status === "accepted"'));
  assert.ok(pipeline.includes('status: uncertain ? "unknown" : "failed"'));
  assert.ok(pipeline.includes("A sending/unknown/failed row is never re-sent automatically"));
  assert.ok(playbookDefinition.includes('["whatsapp_business", new Set(["send_template"])]'));
});

test("CRM sync performs exact-email search first and reconciles ambiguous creates", () => {
  assert.ok(playbookDefinition.includes("exact-email search and one contact-create action"));
  assert.ok(playbookDefinition.includes("Choose one CRM provider for this real-estate Playbook"));
  assert.ok(pipeline.includes('operationId === "search_contacts"'));
  assert.ok(pipeline.includes("crm_contact_created_reconciled"));
  assert.ok(pipeline.includes('task_type: "crm_review"'));
  assert.ok(pipeline.includes("CRM contact synchronisation"));
});

test("Playbook execution uses the exact provider account selected on each registered step", () => {
  assert.ok(pipeline.includes("selectedConnectionId?: string"));
  assert.ok(pipeline.includes('integrationQuery = integrationQuery.eq("id", selectedConnectionId)'));
  assert.ok(pipeline.includes('step.nodeId === "email" && step.operationId === "send_email"'));
  assert.ok(followups.includes("loadPlaybookRuntime"));
  assert.ok(followups.includes('step.nodeId === "email" && step.operationId === "send_email"'));
  assert.ok(followups.includes('encryption_version === "v2"'));
});

test("Calendar inspections check external availability and reserve slots through the guarded database RPC", () => {
  assert.ok(inspectionRoute.includes("operations.manage"));
  assert.ok(inspectionRoute.includes('last_test_status", "passed"'));
  assert.ok(inspectionRoute.includes('findOperation("google_calendar", "execute", "action")'));
  assert.ok(inspectionRoute.includes("timeMin"));
  assert.ok(inspectionRoute.includes("timeMax"));
  assert.ok(inspectionRoute.includes("INSPECTION_CALENDAR_SLOT_BUSY"));
  assert.ok(inspectionRoute.includes("reserve_real_estate_inspection_booking"));
  assert.ok(channelMigration.includes("Customer email invitation requires recorded email contact consent"));
});

test("Calendar event creation requires owner approval and an approved create-event operation", () => {
  assert.ok(inspectionApprovalRoute.includes("Only workspace owners and admins"));
  assert.ok(inspectionApprovalRoute.includes('operation_id", "create_event"'));
  assert.ok(inspectionApprovalRoute.includes("begin_real_estate_inspection_booking"));
  assert.ok(inspectionApprovalRoute.includes('booking.id.replaceAll("-", "")'));
  assert.ok(inspectionApprovalRoute.includes('sendUpdates: invite ? "all" : "none"'));
  assert.ok(inspectionApprovalRoute.indexOf('task_type: "inspection_preparation"') < inspectionApprovalRoute.indexOf('status: "confirmed"'));
  assert.ok(inspectionApprovalRoute.includes('status: uncertain ? "unknown" : "failed"'));
});

test("Back-office task APIs require workspace permissions and task creation is idempotent", () => {
  assert.ok(pipeline.includes("ensureBackOfficeTask"));
  assert.ok(pipeline.includes('task_type: "new_enquiry_review"'));
  assert.ok(pipeline.includes('onConflict: "workspace_id,idempotency_key"'));
  assert.ok(tasksRoute.includes("operations.view"));
  assert.ok(taskItemRoute.includes("operations.manage"));
  assert.ok(taskItemRoute.includes('eq("workspace_id", workspace.id)'));
  assert.ok(operationsPage.includes("Back-office task queue"));
  assert.ok(operationsPage.includes("Approve & create event"));
});

test("Generic live workflow executor cannot bypass the real-estate Playbook pipeline", () => {
  assert.ok(durableWorker.includes("PLAYBOOK_LIVE_EXECUTION_MUST_USE_REAL_ESTATE_PIPELINE"));
  assert.ok(durableWorker.includes('job.execution_mode === "live"'));
  assert.ok(playbookDefinition.includes("whatsapp_business"));
  assert.ok(playbookDefinition.includes("pipedrive"));
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
  assert.match(read("../app/dashboard/real-estate/page.tsx"), /Customer explicitly agreed to follow-up contact by \+leadForm\.contactPreference/);
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
