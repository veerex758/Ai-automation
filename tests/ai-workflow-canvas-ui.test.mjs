import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/dashboard/playbooks/new/page.tsx", import.meta.url), "utf8");
const generator = readFileSync(new URL("../lib/workflows/ai-workflow-generator.cjs", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/dashboard/playbooks/playbooks.css", import.meta.url), "utf8");
const controlRoom = readFileSync(new URL("../app/dashboard/playbooks/[playbookId]/page.tsx", import.meta.url), "utf8");

test("Playbook authoring sends a business outcome while trusted starter rules stay server-side", () => {
  assert.match(page, /What outcome should Rexnora handle/);
  assert.match(page, /What should Rexnora achieve/);
  assert.match(page, /industry: "real_estate"/);
  assert.ok(page.includes("/api/ai/generate-workflow"));
  assert.ok(page.includes("maxLength={240}"));
  assert.ok(page.includes("prompt: outcome.trim()"));
  assert.ok(page.includes('starterType: "real_estate"'));
  assert.ok(page.includes("crmProvider,"));
  assert.ok(!page.includes("const prompt = ["));

  assert.match(generator, /TRUSTED REAL-ESTATE STARTER CONTRACT/);
  assert.match(generator, /whatsapp_business\\.send_template/);
  assert.match(generator, /selected CRM provider is/);
  assert.match(generator, /search_contacts by exact lead email/);
  assert.match(generator, /Do not add Google Calendar create-event actions/);
  assert.match(generator, /durable 90-day follow-up service/);
  assert.match(generator, /Use only registered Rexnora nodes and operations/);
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
