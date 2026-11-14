import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeUrl = new URL("../app/api/webhooks/[endpointKey]/route.ts", import.meta.url);
const workerUrl = new URL("../lib/workflows/durable-worker.ts", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20261029222027_aivanta_webhook_ingress_foundation.sql", import.meta.url);
const queueMigrationUrl = new URL("../supabase/migrations/20261114120000_aivanta_durable_webhook_live_queue.sql", import.meta.url);

test("webhook ingress authenticates raw bytes with the endpoint encrypted signing secret", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /decryptWebhookSecret\(ciphertextBytes\(endpoint\.secret_ciphertext\)/);
  assert.match(source, /verifyWebhookSignature\(\{[\s\S]*rawBody,[\s\S]*signatureHeader,[\s\S]*secret: signingSecret/);
  assert.match(source, /toleranceSeconds: MAX_EVENT_AGE_SECONDS/);
  assert.match(source, /endpoint\.secret_key_version !== configuredKeyVersion/);
});

test("webhook ingress enforces streaming body and durable queue payload caps", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /MAX_BODY_BYTES = 256 \* 1024/);
  assert.match(source, /total \+= value\.byteLength/);
  assert.match(source, /if \(total > MAX_BODY_BYTES\)/);
  assert.match(source, /12000/);
  assert.ok(source.indexOf("readBoundedBody(request)") < source.indexOf("JSON.parse(rawBody.toString"));
});

test("webhook ingress claims event IDs atomically and rejects changed-payload replays", async () => {
  const source = await readFile(routeUrl, "utf8");
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /unique \(endpoint_id, event_id\)/);
  assert.match(migration, /on conflict \(endpoint_id, event_id\) do nothing/i);
  assert.match(source, /rpc\("claim_webhook_event"/);
  assert.match(source, /prior\.payload_sha256 !== payloadSha256/);
  assert.match(source, /duplicate: !claim\.accepted/);
});

test("verified webhook dispatch is workspace-bound and always uses the durable live queue", async () => {
  const source = await readFile(routeUrl, "utf8");
  const worker = await readFile(workerUrl, "utf8");
  assert.match(source, /\.eq\("id", endpoint\.workflow_id\)\.eq\("workspace_id", endpoint\.workspace_id\)/);
  assert.match(source, /AIVANTA_LIVE_EXECUTION_ENABLED !== "true"/);
  assert.match(source, /AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED !== "true"/);
  assert.match(source, /validateDurableLiveSteps\(steps\)/);
  assert.match(source, /p_execution_mode: "live"/);
  assert.match(source, /p_created_by: null/);
  assert.match(source, /webhookVerified: true/);
  assert.match(source, /payloadSha256/);
  assert.match(source, /queued: true/);
  assert.doesNotMatch(source, /executeRegisteredWorkflow/);
  assert.doesNotMatch(source, /RESEND_API_KEY|GEMINI_API_KEY/);
  assert.match(worker, /source === "webhook"/);
  assert.match(worker, /job\.payload\?\.webhookVerified === true/);
});

test("webhook system dispatch can omit an interactive actor only with verified system-event metadata", async () => {
  const migration = await readFile(queueMigrationUrl, "utf8");
  assert.match(migration, /p_created_by is null/);
  assert.match(migration, /event_source in \('webhook','schedule','error_trigger'\)/);
  assert.match(migration, /p_payload->>'webhookVerified' = 'true'/);
  assert.match(migration, /grant execute on function public\.dispatch_workflow_execution/);
});

test("duplicate webhook deliveries re-attempt the idempotent durable queue dispatch", async () => {
  const source = await readFile(routeUrl, "utf8");
  const duplicate = source.slice(source.indexOf("if (!claim.accepted)"), source.indexOf("const eventKey"));
  assert.match(duplicate, /prior\.payload_sha256 !== payloadSha256/);
  assert.match(source, /const eventKey = createHash\("sha256"\)/);
  assert.match(source, /"webhook:" \+ endpoint\.id \+ ":" \+ eventKey/);
  assert.match(source, /dispatch_workflow_execution/);
});

test("webhook event payload remains server-side while checkpoint history stores only metadata and hash", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /payloadSha256/);
  assert.match(worker, /safeWebhookTriggerOutput/);
  assert.match(worker, /initialOutputs\[steps\[0\]\.id\] = job\.payload\.input/);
  assert.doesNotMatch(route, /from\("workflow_run_steps"\)/);
});

test("endpoint provisioning is authenticated and returns the signing secret only once", async () => {
  const provisionUrl = new URL("../app/api/workflows/[workflowId]/webhook/route.ts", import.meta.url);
  const source = await readFile(provisionUrl, "utf8");
  assert.match(source, /userClient\.auth\.getUser/);
  assert.match(source, /body\.confirm !== true/);
  assert.match(source, /encryptWebhookSecret\(signingSecret, encryptionKey\)/);
  assert.match(source, /endpoint_key_hash: createHash\("sha256"\)/);
  assert.match(source, /secretShownOnce: true/);
  assert.match(source, /status: "active"/);
});
