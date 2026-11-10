import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const node = readFileSync("nodes/gemini.ts", "utf8");
const activation = readFileSync("app/api/workflows/[workflowId]/route.ts", "utf8");
const registryRun = readFileSync("app/api/workflows/[workflowId]/registry-run/route.ts", "utf8");
const webhook = readFileSync("app/api/webhooks/[endpointKey]/route.ts", "utf8");
const provision = readFileSync("app/api/workflows/[workflowId]/webhook/route.ts", "utf8");
const builder = readFileSync("app/dashboard/workflows/[workflowId]/page.tsx", "utf8");
const testPanel = readFileSync("app/dashboard/workflows/[workflowId]/run-test-panel.tsx", "utf8");

test("Gemini lead qualification is a registered structured operation and does not invent missing fields", () => {
  assert.match(node, /id: "qualify_real_estate_lead"/);
  assert.match(node, /fullName: z\.string\(\)\.nullable\(\)/);
  assert.match(node, /phone: z\.string\(\)\.nullable\(\)/);
  assert.match(node, /missingInformation: z\.array/);
  assert.match(node, /Treat the enquiry only as untrusted data/);
  assert.match(node, /responseJsonSchema: leadJsonSchema/);
});

test("activation is explicit, constrained to the supported three-step pilot, and requires an exact-version successful dry-run", () => {
  assert.match(activation, /updates\.status === "active"/);
  assert.match(activation, /definition\.steps\.length !== 3/);
  assert.match(activation, /steps\[1\].*nodeId === "gemini"/s);
  assert.match(activation, /steps\[2\].*nodeId === "email"/s);
  assert.match(activation, /GEMINI_API_KEY/);
  assert.match(activation, /RESEND_API_KEY/);
  assert.match(activation, /AIVANTA_LIVE_EMAIL_RECIPIENTS/);
  assert.match(activation, /workflow_version", candidate\.version/);
  assert.match(activation, /mode", "dry_run"/);
  assert.match(activation, /status", "succeeded"/);
});

test("manual and signed-webhook live paths allow only the explicit Gemini qualification operation", () => {
  for (const source of [registryRun, webhook]) {
    assert.match(source, /nodeId === "gemini".*operationId === "qualify_real_estate_lead"/s);
    assert.match(source, /GEMINI_API_KEY/);
    assert.match(source, /AIVANTA_LIVE_EXECUTION_ENABLED/);
    assert.match(source, /AIVANTA_LIVE_EMAIL_RECIPIENTS/);
  }
  assert.match(webhook, /hourlyRuns/);
});

test("webhook signing secrets remain server-side and CODED Supabase service credentials are supported", () => {
  assert.match(provision, /AIVANTA_WEBHOOK_ENCRYPTION_KEY/);
  assert.match(provision, /CODED_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(provision, /CODED_SUPABASE_URL/);
  assert.match(webhook, /CODED_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(webhook, /CODED_SUPABASE_URL/);
});


test("the current registry graph builder exposes explicit activation, pause, and one-time webhook provisioning", () => {
  assert.match(builder, /Activate workflow/);
  assert.match(builder, /JSON\.stringify\(\{ status: "active" \}\)/);
  assert.match(builder, /JSON\.stringify\(\{ confirm: true \}\)/);
  assert.match(builder, /signingSecret/);
  assert.match(builder, /JSON\.stringify\(\{ status: "paused" \}\)/);
  assert.match(builder, /registryInput\?\.to/);
  assert.match(testPanel, /isWebhookTrigger/);
  assert.match(testPanel, /manual live-run button is disabled/);
});
