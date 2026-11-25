import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/dashboard/playbooks/new/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/dashboard/playbooks/playbooks.css", import.meta.url), "utf8");
const controlRoom = readFileSync(new URL("../app/dashboard/playbooks/[playbookId]/page.tsx", import.meta.url), "utf8");
const generatorRoute = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");

test("Playbook authoring starts with a business outcome instead of a canvas", () => {
  assert.match(page, /What outcome should Rexnora handle/);
  assert.match(page, /What should Rexnora achieve/);
  assert.match(page, /industry: "real_estate"/);
  assert.match(page, /api\/ai\/generate-workflow/);
  assert.match(page, /Use registered Rexnora operations only/);
  assert.match(page, /whatsapp_business\.send_template/);
  assert.match(page, /selected CRM for this starter is/);
  assert.match(page, /search_contacts by the exact lead email, then execute to create only when no exact match exists/);
  assert.match(page, /Do not put Google Calendar create-event actions in the generic Playbook/);
  assert.match(page, /durable 90-day follow-up service/);
});

test("business rules are linked to actual generated graph condition nodes", () => {
  assert.match(page, /filter\(\(node\) => node\.type === "condition"\)/);
  assert.match(page, /nodeId: node\.id/);
  assert.match(page, /Business rules/);
  assert.match(page, /source of truth/);
});

test("every registered action exposes the three explicit permission modes", () => {
  assert.match(page, /Auto — after all checks/);
  assert.match(page, /Ask me first/);
  assert.match(page, /Never allow/);
  assert.match(page, /permission: step\.nodeId === "gemini" \? "auto" as const : "ask_first" as const/);
});

test("review thresholds and exception paths are explicit before draft save", () => {
  assert.match(page, /confidenceThreshold: confidence/);
  assert.match(page, /reviewMissingFields/);
  assert.match(page, /reviewWhenNoRuleMatches/);
  assert.match(page, /reviewProviderFailures/);
  assert.match(page, /useState\(true\)/);
});

test("setup creates an inactive draft and routes guarded activation through the Control Room", () => {
  assert.match(page, /status: "draft"/);
  assert.match(page, /const definition = \{ \.\.\.draft\.definition, playbook \}/);
  assert.match(page, /registrySteps: draft\.registrySteps/);
  assert.match(page, /Save Playbook draft/);
  assert.match(page, /Open the Control Room to test and activate it after the server verifies/);
  assert.doesNotMatch(page, /status: "active"|\/activate|\/execute|\/dispatch/);
  assert.match(controlRoom, /Activate Playbook/);
  assert.match(controlRoom, /method: "PATCH"/);
  assert.match(controlRoom, /Activation is checked server-side/);
});

test("Playbook setup layout adapts to phone screens", () => {
  assert.match(styles, /@media\(max-width:850px\)/);
  assert.match(styles, /\.playbook-rule-fields\{grid-template-columns:1fr\}/);
  assert.match(styles, /\.playbook-save-row\{flex-direction:column\}/);
});


test("Playbook outcome accepts longer requests", () => {
  assert.ok(page.includes("maxLength={2000}"));
  assert.ok(page.includes("outcome.length}/2000 characters"));
  assert.ok(page.includes("body: JSON.stringify({ prompt, crmProvider })"));
  assert.ok(generatorRoute.includes("contentLength > 24000"));
});

test("CRM starter uses selected provider operations and reports the failing node", () => {
  assert.ok(page.includes("step id intake"));
  assert.ok(page.includes(".search_contacts"));
  assert.ok(page.includes(".execute"));
  assert.ok(generatorRoute.includes("search_contacts"));
  assert.ok(generatorRoute.includes("payload.firstName"));
  assert.ok(generatorRoute.includes("payload.lastName"));
  assert.ok(generatorRoute.includes("validateOperationInput"));
  assert.ok(generatorRoute.includes("validateCrmSearchCreateGuard"));
  assert.ok(generatorRoute.includes("failingNode:"));
  assert.ok(page.includes("Failing node:"));
});
