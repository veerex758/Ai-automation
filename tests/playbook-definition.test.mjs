import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validatePlaybookDefinition, validateCrmSearchCreateGuard } = require("../lib/playbooks/definition.cjs");

const graph = {
  version: 1,
  nodes: [
    { id: "trigger", type: "trigger" },
    { id: "if-qualified", type: "condition" },
    { id: "notify", type: "action" },
    { id: "ask-agent", type: "action" },
  ],
};
const steps = [
  { id: "trigger", nodeId: "webhooks", operationId: "receive_event", kind: "trigger", input: {} },
  { id: "ask-agent", nodeId: "gemini", operationId: "qualify_real_estate_lead", kind: "action", input: { leadData: {} } },
  { id: "if-qualified", nodeId: "if", operationId: "evaluate", kind: "action", input: { value: "{{trigger.payload.score}}", operator: "greater_than", compareTo: 70 } },
  { id: "notify", nodeId: "email", operationId: "send_email", kind: "action", input: { to: "agency@example.com", subject: "New lead", text: "Review" } },
];
const valid = {
  schema: "rexnora.playbook",
  schemaVersion: 1,
  goal: { industry: "real_estate", outcome: "Qualify new property enquiries and route the right next action." },
  rules: [{ id: "qualified-lead", nodeId: "if-qualified", name: "Qualified lead", rationale: "Send high-intent enquiries to the agency." }],
  actionPolicies: [
    { stepId: "notify", nodeId: "email", operationId: "send_email", permission: "ask_first" },
    { stepId: "ask-agent", nodeId: "gemini", operationId: "qualify_real_estate_lead", permission: "auto" },
  ],
  review: {
    confidenceThreshold: 0.8,
    reviewMissingFields: true,
    reviewWhenNoRuleMatches: true,
    reviewProviderFailures: true,
  },
};

test("accepts a versioned Playbook bound to the exact graph and registered operations", () => {
  const result = validatePlaybookDefinition(valid, graph, steps);
  assert.equal(result.error, undefined);
  assert.equal(result.playbook.schema, "rexnora.playbook");
  assert.equal(result.playbook.actionPolicies.find((policy) => policy.stepId === "notify").permission, "ask_first");
  assert.deepEqual(result.playbook.rules.map((rule) => rule.nodeId), ["if-qualified"]);
});

test("requires one human-readable rule for every graph condition", () => {
  const result = validatePlaybookDefinition({ ...valid, rules: [] }, graph, steps);
  assert.match(result.error, /Every IF condition/);
});

test("rejects action permissions that refer to a different registered operation", () => {
  const actionPolicies = valid.actionPolicies.map((policy) =>
    policy.stepId === "notify" ? { ...policy, operationId: "delete_everything" } : policy
  );
  const result = validatePlaybookDefinition({ ...valid, actionPolicies }, graph, steps);
  assert.match(result.error, /do not match the saved registered operations/);
});

test("requires an explicit permission for every external or model action", () => {
  const result = validatePlaybookDefinition({ ...valid, actionPolicies: valid.actionPolicies.slice(0, 1) }, graph, steps);
  assert.match(result.error, /Every registered action/);
});

test("rejects unsafe or ambiguous review thresholds", () => {
  const result = validatePlaybookDefinition({
    ...valid,
    review: { ...valid.review, confidenceThreshold: 1.2 },
  }, graph, steps);
  assert.match(result.error, /confidence threshold/);
});

test("rejects unsupported fields and future schema versions", () => {
  assert.match(validatePlaybookDefinition({ ...valid, autonomousMode: true }, graph, steps).error, /unsupported field/);
  assert.match(validatePlaybookDefinition({ ...valid, schemaVersion: 2 }, graph, steps).error, /Unsupported Playbook schema version/);
});

test("does not treat deterministic IF evaluators as external action permissions", () => {
  const result = validatePlaybookDefinition(valid, graph, steps);
  assert.equal(result.error, undefined);
  assert.equal(result.playbook.actionPolicies.length, 2);
});

test("returns an explicit permission map rather than silently deriving permissions", () => {
  const changed = structuredClone(valid);
  changed.actionPolicies[0].permission = "auto";
  const result = validatePlaybookDefinition(changed, graph, steps);
  assert.equal(result.playbook.actionPolicies.find((policy) => policy.stepId === "notify").permission, "auto");
  assert.equal(result.playbook.actionPolicies.find((policy) => policy.stepId === "ask-agent").permission, "auto");
});

test("rejects action types outside the real-estate pilot operation set", () => {
  const unsupportedSteps = steps.map((step) =>
    step.nodeId === "email" ? { ...step, operationId: "delete_record" } : step
  );
  const result = validatePlaybookDefinition(valid, graph, unsupportedSteps);
  assert.ok(result.error.includes("Unsupported real-estate Playbook action: email.delete_record"));
});

test("requires exactly one supported Gemini qualification action", () => {
  const withoutGemini = steps.filter((step) => step.nodeId !== "gemini");
  const result = validatePlaybookDefinition(valid, graph, withoutGemini);
  assert.match(result.error, /exactly one Gemini lead-qualification action/);
});


test("requires Gemini qualification before rules and rules before agency notification", () => {
  const invalidOrder = [steps[0], steps[2], steps[1], steps[3]];
  const result = validatePlaybookDefinition(valid, graph, invalidOrder);
  assert.match(result.error, /Gemini qualification must precede/);
});

test("rejects Playbook rules that have no registered IF evaluator", () => {
  const missingEvaluator = steps.filter((step) => step.id !== "if-qualified");
  const result = validatePlaybookDefinition(valid, graph, missingEvaluator);
  assert.match(result.error, /backed by one registered IF evaluator/);
});


test("rejects Switch operations until the Playbook replay and worker support them", () => {
  const switchSteps = [
    steps[0],
    steps[1],
    { id: "route-switch", nodeId: "switch", operationId: "select_route", kind: "action", input: { value: "buy", cases: [{ value: "buy", route: "buy" }] } },
    steps[2],
    steps[3],
  ];
  const result = validatePlaybookDefinition(valid, graph, switchSteps);
  assert.ok(result.error.includes("Unsupported real-estate Playbook action: switch.select_route"));
});


const crmGuardSteps = [
  { id: "trigger", nodeId: "webhooks", operationId: "receive_event", kind: "trigger", input: {} },
  { id: "crm-search", nodeId: "pipedrive", operationId: "search_contacts", kind: "action", input: { email: "{{trigger.payload.email}}" } },
  { id: "if-no-match", nodeId: "if", operationId: "evaluate", kind: "action", input: { value: "{{crm-search.contacts}}", operator: "is_empty" } },
  { id: "crm-create", nodeId: "pipedrive", operationId: "execute", kind: "action", input: { email: "{{trigger.payload.email}}", firstName: "{{trigger.payload.firstName}}", lastName: "{{trigger.payload.lastName}}" }, branchPaths: [[{ fromStepId: "if-no-match", route: "true" }]] },
];

test("CRM create is allowed only on the true branch of an empty exact-email search", () => {
  assert.equal(validateCrmSearchCreateGuard(crmGuardSteps), null);
});

test("CRM create is rejected when it would run unconditionally after search", () => {
  const unsafe = structuredClone(crmGuardSteps);
  delete unsafe[3].branchPaths;
  const result = validateCrmSearchCreateGuard(unsafe);
  assert.match(result.error, /only through the true branch/);
  assert.equal(result.failingNode.stepId, "crm-create");
});

test("CRM create is rejected when the IF condition does not inspect the search result", () => {
  const unsafe = structuredClone(crmGuardSteps);
  unsafe[2].input.value = "{{trigger.payload.email}}";
  const result = validateCrmSearchCreateGuard(unsafe);
  assert.match(result.error, /empty contacts list/);
});

test("CRM search and create must use the same selected connection", () => {
  const unsafe = structuredClone(crmGuardSteps);
  unsafe[1].connectionId = "11111111-1111-4111-8111-111111111111";
  unsafe[3].connectionId = "22222222-2222-4222-8222-222222222222";
  const result = validateCrmSearchCreateGuard(unsafe);
  assert.match(result.error, /same selected workspace connection/);
});


test("accepts a business outcome up to 2000 characters and 240 words", () => {
  const longOutcome = "123456789 ".repeat(199) + "1234567890";
  const result = validatePlaybookDefinition({
    ...valid,
    goal: { ...valid.goal, outcome: longOutcome },
  }, graph, steps);
  assert.equal(longOutcome.length, 2000);
  assert.equal(longOutcome.trim().split(/\s+/).length, 200);
  assert.equal(result.error, undefined);
  assert.equal(result.playbook.goal.outcome.length, 2000);
});

test("rejects a business outcome longer than 2000 characters", () => {
  const result = validatePlaybookDefinition({
    ...valid,
    goal: { ...valid.goal, outcome: "x".repeat(2001) },
  }, graph, steps);
  assert.match(result.error, /1–2,000 characters and no more than 240 words/);
});

test("rejects a business outcome over 240 words even when under 2000 characters", () => {
  const result = validatePlaybookDefinition({
    ...valid,
    goal: { ...valid.goal, outcome: "word ".repeat(241).trim() },
  }, graph, steps);
  assert.match(result.error, /no more than 240 words/);
});

test("keeps the separate 240-character Playbook rule rationale limit", () => {
  const result = validatePlaybookDefinition({
    ...valid,
    rules: [{ ...valid.rules[0], rationale: "x".repeat(241) }],
  }, graph, steps);
  assert.match(result.error, /rule/);
});
