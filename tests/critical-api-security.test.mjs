import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [billing, invoiceDocs, cancel, invoiceIssue, paystackStart, stripeStart, paystackWebhook, stripeWebhook, renewals, scheduler, cronAutomation, cronFollowups, cronPipeline, googleConnections, googleStart, googleCallback, publicWebhook, liveRun, notificationRecipients, followupWorker, pipelineWorker] = await Promise.all([
  read("../app/api/billing/route.ts"),
  read("../app/api/billing/invoice-docs/[invoiceId]/route.ts"),
  read("../app/api/billing/cancel/route.ts"),
  read("../app/api/billing/invoices/[paymentId]/issue/route.ts"),
  read("../app/api/billing/paystack/recurring/authorize/route.ts"),
  read("../app/api/billing/stripe/subscribe/route.ts"),
  read("../app/api/billing/webhook/route.ts"),
  read("../app/api/billing/stripe/subscription-webhook/route.ts"),
  read("../app/api/internal/billing/paystack-renewals/route.ts"),
  read("../app/api/internal/scheduler/route.ts"),
  read("../app/api/cron/real-estate-automation/route.ts"),
  read("../app/api/cron/real-estate-followups/route.ts"),
  read("../app/api/cron/real-estate-pipeline/route.ts"),
  read("../app/api/integrations/google/connections/route.ts"),
  read("../app/api/integrations/google/start/route.ts"),
  read("../app/api/integrations/google/callback/route.ts"),
  read("../app/api/webhooks/[endpointKey]/route.ts"),
  read("../app/api/workflows/[workflowId]/live-run/route.ts"),
  read("../app/api/real-estate/notification-recipients/route.ts"),
  read("../lib/real-estate/followups.ts"),
  read("../lib/real-estate/pipeline.ts"),
]);

test("billing reads and mutations are authenticated, workspace-scoped and role-gated", () => {
  assert.match(billing, /billing\.view/);
  assert.match(billing, /workspace\.id/);
  assert.match(invoiceDocs, /billing\.view/);
  assert.match(invoiceDocs, /workspace\.id/);
  assert.match(invoiceDocs, /uuidPattern\.test\(invoiceId\)/);
  assert.match(invoiceDocs, /private, no-store/);
  assert.match(cancel, /canManageWorkspaceBilling/);
  assert.match(cancel, /sourceOrigin/);
  assert.match(cancel, /private, no-store/);
  assert.match(invoiceIssue, /canManageWorkspaceBilling/);
  assert.match(invoiceIssue, /uuidPattern\.test\(paymentId\)/);
  assert.match(invoiceIssue, /\.eq\("workspace_id",workspace\.id\)/);
});

test("recurring checkout validates plan, explicit consent, request size and same-origin", () => {
  for (const route of [paystackStart, stripeStart]) {
    assert.match(route, /getPaidPlan/);
    assert.match(route, /body\.consent!==true/);
    assert.match(route, /Billing request exceeds 4 KiB/);
    assert.match(route, /sourceOrigin/);
    assert.match(route, /canManageWorkspaceBilling/);
    assert.match(route, /private, no-store/);
  }
  assert.match(stripeStart, /price\.active/);
  assert.match(stripeStart, /price\.unit_amount/);
});

test("payment webhooks verify provider signatures and deduplicate provider events", () => {
  assert.match(paystackWebhook, /isValidPaystackSignature/);
  assert.match(paystackWebhook, /billing_webhook_events/);
  assert.match(paystackWebhook, /processed_at/);
  assert.match(paystackWebhook, /256\*1024/);
  assert.match(stripeWebhook, /constructEvent/);
  assert.match(stripeWebhook, /billing_recurring_events/);
  assert.match(stripeWebhook, /processed_at/);
  assert.match(stripeWebhook, /256\*1024/);
});

test("internal scheduler and renewal workers require timing-safe cron authentication", () => {
  assert.match(renewals, /CRON_SECRET/);
  assert.match(renewals, /timingSafeEqual/);
  assert.match(renewals, /claim_paystack_recurring_renewal/);
  assert.match(renewals, /private, no-store/);
  assert.match(scheduler, /CRON_SECRET/);
  assert.match(scheduler, /timingSafeEqual/);
  assert.match(scheduler, /getAdminSupabaseConfig/);
});

test("real-estate cron workers require cron authentication and fail closed on live flags", () => {
  for (const route of [cronAutomation, cronFollowups, cronPipeline]) {
    assert.match(route, /CRON_SECRET/);
    assert.match(route, /timingSafeEqual/);
    assert.match(route, /private, no-store/);
  }
  assert.match(cronAutomation, /AIVANTA_LIVE_EXECUTION_ENABLED/);
  assert.match(cronPipeline, /AIVANTA_LIVE_EXECUTION_ENABLED/);
  assert.match(followupWorker, /REAL_ESTATE_FOLLOWUPS_ENABLED !== "true"/);
  assert.match(followupWorker, /AIVANTA_LIVE_EXECUTION_ENABLED !== "true"/);
  assert.match(pipelineWorker, /AIVANTA_LIVE_EXECUTION_ENABLED/);
});

test("Google OAuth uses owner/admin authorization, state, PKCE and approved read-only scopes", () => {
  assert.match(googleConnections, /integrations\.view/);
  assert.match(googleConnections, /requireWorkspaceAdmin/);
  assert.match(googleConnections, /\.eq\("workspace_id", workspace\.id\)/);
  assert.match(googleStart, /aivanta_google_oauth_state/);
  assert.match(googleStart, /code_challenge_method/);
  assert.match(googleStart, /Only workspace owners and admins/);
  assert.match(googleCallback, /state !== expectedState/);
  assert.match(googleCallback, /user\.id !== initiatingUserId/);
  assert.match(googleCallback, /hasOnlyApprovedGoogleScopes/);
});

test("public webhook delivery verifies hashed endpoint, HMAC, replay window and bounded body", () => {
  assert.match(publicWebhook, /endpoint_key_hash/);
  assert.match(publicWebhook, /verifyWebhookSignature/);
  assert.match(publicWebhook, /MAX_BODY_BYTES/);
  assert.match(publicWebhook, /MAX_EVENT_AGE_SECONDS/);
  assert.match(publicWebhook, /endpoint\.workspace_id/);
  assert.match(publicWebhook, /AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED/);
  assert.match(publicWebhook, /private, no-store/);
  assert.match(liveRun, /disabled/);
});

test("agency alert recipients are workspace-visible only with real-estate read access", () => {
  assert.match(notificationRecipients, /real_estate\.view/);
  assert.match(notificationRecipients, /Only a workspace owner or admin/);
  assert.match(notificationRecipients, /\.eq\("workspace_id", auth\.workspace\.id\)/);
});


test("workflow version restore, schedule deletion and dispatch enforce workspace permissions", async () => {
  const [versions, schedule, dispatch] = await Promise.all([
    read("../app/api/workflows/[workflowId]/versions/route.ts"),
    read("../app/api/workflows/[workflowId]/schedule/route.ts"),
    read("../app/api/workflows/[workflowId]/dispatch/route.ts"),
  ]);
  assert.ok(versions.includes('hasWorkspacePermission(supabase, workflow.workspace_id, user.id, "workflows.view")'));
  assert.ok(versions.includes('hasWorkspacePermission(supabase, workflow.workspace_id, user.id, "workflows.edit")'));
  assert.ok(schedule.includes('hasWorkspacePermission(supabase, workflow.workspace_id, user.id, "workflows.execute")'));
  assert.ok(schedule.includes('.eq("workspace_id", workflow.workspace_id)'));
  assert.ok(dispatch.includes('hasWorkspacePermission(userDb, workflow.workspace_id, user.id, "workflows.execute")'));
  for (const route of [versions, schedule, dispatch]) assert.ok(route.includes("enforceDistributedRateLimit"));
});

test("paid actions, OAuth callbacks and workspace administration use distributed abuse controls", async () => {
  const routes = await Promise.all([
    read("../app/api/billing/checkout/route.ts"),
    read("../app/api/billing/stripe/checkout/route.ts"),
    read("../app/api/billing/stripe/subscribe/route.ts"),
    read("../app/api/billing/paystack/recurring/authorize/route.ts"),
    read("../app/api/billing/cancel/route.ts"),
    read("../app/api/marketplace/checkout/route.ts"),
    read("../app/api/marketplace/bundles/checkout/route.ts"),
    read("../app/api/marketplace/subscriptions/checkout/route.ts"),
    read("../app/api/workspaces/[workspaceId]/invitations/route.ts"),
    read("../app/api/workspaces/[workspaceId]/roles/assign/route.ts"),
    read("../app/api/integrations/google/callback/route.ts"),
    read("../app/api/integrations/oauth/[provider]/callback/route.ts"),
  ]);
  for (const route of routes) assert.ok(route.includes("enforceDistributedRateLimit"));
  const [googleCallback, providerCallback] = routes.slice(-2);
  assert.ok(googleCallback.indexOf("workspace_members") < googleCallback.indexOf("oauth2.googleapis.com/token"));
  assert.ok(providerCallback.indexOf("workspace_members") < providerCallback.indexOf("await exchangeProviderOAuthCode"));
  assert.ok(routes[0].includes("canManageWorkspaceBilling"));
  assert.ok(routes[5].includes("auth.getUser"));
});

test("workspace integration secret writes and reads preserve tenant-bound v3 support", async () => {
  const [save, testConnection, worker] = await Promise.all([
    read("../app/api/integrations/workspace/route.ts"),
    read("../app/api/integrations/workspace/test/route.ts"),
    read("../lib/workflows/durable-worker.ts"),
  ]);
  assert.ok(save.includes("encryptWorkspaceCredentialsV2"));
  assert.ok(save.includes("save_workspace_integration_connection"));
  assert.ok(testConnection.includes('["v1", "v2", "v3"].includes(secret.encryption_version)'));
  assert.ok(worker.includes('["v1", "v2", "v3"].includes(secret.encryption_version)'));
  assert.ok(testConnection.includes("workspace.id"));
  assert.ok(worker.includes("workspace_id"));
});
