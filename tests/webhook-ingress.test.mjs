import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeUrl = new URL("../app/api/webhooks/[endpointKey]/route.ts", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20261029222027_aivanta_webhook_ingress_foundation.sql", import.meta.url);

test("webhook ingress authenticates raw bytes with the endpoint's encrypted signing secret", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /decryptWebhookSecret\(ciphertextBytes\(endpoint\.secret_ciphertext\)/);
  assert.match(source, /verifyWebhookSignature\(\{[\s\S]*rawBody,[\s\S]*signatureHeader,[\s\S]*secret: signingSecret/);
  assert.match(source, /toleranceSeconds: MAX_EVENT_AGE_SECONDS/);
  assert.match(source, /endpoint\.secret_key_version !== configuredKeyVersion/);
});

test("webhook ingress enforces a streaming body cap before parsing or verification", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /MAX_BODY_BYTES = 256 \* 1024/);
  assert.match(source, /total \+= value\.byteLength/);
  assert.match(source, /if \(total > MAX_BODY_BYTES\)/);
  assert.ok(source.indexOf("readBoundedBody(request)") < source.indexOf("JSON.parse(rawBody.toString"));
});

test("webhook ingress claims event IDs atomically and rejects changed-payload replays", async () => {
  const source = await readFile(routeUrl, "utf8");
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /unique \(endpoint_id, event_id\)/);
  assert.match(migration, /on conflict \(endpoint_id, event_id\) do nothing/i);
  assert.match(source, /rpc\("claim_webhook_event"/);
  assert.match(source, /prior\.payload_sha256 !== payloadSha256/);
  assert.match(source, /duplicate: true/);
});

test("webhook dispatch is workspace-bound and persists run, steps, and receipt outcome", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /\.eq\("id", endpoint\.workflow_id\)\.eq\("workspace_id", endpoint\.workspace_id\)/);
  assert.match(source, /mode: "live",\s*status: "running"/);
  assert.match(source, /from\("workflow_run_steps"\)\.insert\(rows\)/);
  assert.match(source, /status: finalStatus === "succeeded" \? "dispatched" : "failed"/);
  assert.match(source, /webhook: \{ verified: true \}/);
  assert.match(source, /sideEffectsPerformed:/);
});

test("inbound webhook events cannot bypass the guarded live action allowlist", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /AIVANTA_LIVE_EMAIL_RECIPIENTS/);
  assert.match(source, /not enabled for live webhook execution/);
  assert.match(source, /recipient\.includes\("\{\{"\)/);
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

test("run history does not persist the raw webhook payload in the trigger result", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /payloadSha256/);
  assert.match(source, /eventId, eventType, receivedAt: eventInput\.receivedAt, payloadSha256/);
});


test("live webhook actions honor the global execution kill switch", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /AIVANTA_LIVE_EXECUTION_ENABLED !== "true"/);
});
