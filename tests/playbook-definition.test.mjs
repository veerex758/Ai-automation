import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validatePlaybookDefinition } = require("../lib/playbooks/definition.cjs");

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
  { id: "if-qualified", nodeId: "if", operationId: "evaluate", kind: "action", input: { value: "{{trigger.payload.score}}", operator: "greater_than", compareTo: 70 } },
  { id: "notify", nodeId: "email", operationId: "send_email", kind: "action", input: { to: "agency@example.com", subject: "New lead", text: "Review" } },
  { id: "ask-agent", nodeId: "gemini", operationId: "qualify_real_estate_lead", kind: "action", input: { leadData: {} } },
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
  assert.equal(result.playbook.actionPolicies[0].permission, "ask_first");
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
  assert.equal(result.playbook.actionPolicies[0].permission, "auto");
  assert.equal(result.playbook.actionPolicies[1].permission, "auto");
});
