import test from "node:test";
import assert from "node:assert/strict";
import { replayPlaybookAgainstLead } from "../lib/playbooks/replay.ts";

const playbook = {
  schema: "rexnora.playbook",
  schemaVersion: 1,
  goal: { industry: "real_estate", outcome: "Qualify property enquiries" },
  rules: [{ id: "budget-qualified", nodeId: "condition-budget", name: "Budget qualified", rationale: "Budget meets the target." }],
  actionPolicies: [
    { stepId: "qualify", nodeId: "gemini", operationId: "qualify_real_estate_lead", permission: "auto" },
    { stepId: "notify", nodeId: "email", operationId: "send_email", permission: "ask_first" },
  ],
  review: { confidenceThreshold: 0.8, reviewMissingFields: true, reviewWhenNoRuleMatches: true, reviewProviderFailures: true },
};
const steps = [
  { id: "condition-budget", nodeId: "if", operationId: "evaluate", kind: "action", input: { value: "{{trigger.payload.budget_min}}", operator: "greater_or_equal", compareTo: 100000 } },
  { id: "qualify", nodeId: "gemini", operationId: "qualify_real_estate_lead", kind: "action", input: {} },
  { id: "notify", nodeId: "email", operationId: "send_email", kind: "action", input: {} },
];

test("replay uses the same deterministic IF comparison and produces a matching route", () => {
  const result = replayPlaybookAgainstLead(playbook, steps, {
    id: "lead-1",
    full_name: "Sample Buyer",
    budget_min: 150000,
    qualification: { confidence: 0.93 },
  });
  assert.equal(result.rules[0].outcome, "matched");
  assert.equal(result.rules[0].route, "true");
  assert.equal(result.requiresReview, false);
  assert.equal(result.confidence, 0.93);
});

test("replay routes a condition with missing historical fields to review", () => {
  const result = replayPlaybookAgainstLead(playbook, steps, {
    id: "lead-2",
    full_name: "Incomplete Buyer",
    budget_min: null,
    qualification: {},
  });
  assert.equal(result.rules[0].outcome, "needs_review");
  assert.equal(result.requiresReview, true);
  assert.ok(result.reviewReasons.some((reason) => /missing/i.test(reason)));
});

test("replay never calls providers, mutates lead data or writes execution state", () => {
  const lead = { id: "lead-3", full_name: "Replay Only", budget_min: 250000, qualification: { confidence: 0.91 } };
  const before = structuredClone(lead);
  const result = replayPlaybookAgainstLead(playbook, steps, lead);
  assert.deepEqual(lead, before);
  assert.equal(result.sideEffects, false);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.writes, 0);
  assert.equal(result.actions[0].preview, "would_be_eligible_after_all_runtime_checks");
  assert.equal(result.actions[1].preview, "would_require_approval");
});

test("a never-permitted action is always displayed as blocked", () => {
  const result = replayPlaybookAgainstLead({
    ...playbook,
    actionPolicies: [{ ...playbook.actionPolicies[0], permission: "never" }],
  }, steps, { id: "lead-4", full_name: "Blocked", budget_min: 250000, qualification: { confidence: 0.9 } });
  assert.equal(result.actions[0].preview, "blocked_by_policy");
});

test("replay marks actions excluded by the deterministic selected branch", () => {
  const branchedSteps = [
    ...steps,
    { id: "notify", nodeId: "email", operationId: "send_email", kind: "action", input: {}, branchPaths: [[{ fromStepId: "condition-budget", route: "false" }]] },
  ];
  const result = replayPlaybookAgainstLead({
    ...playbook,
    actionPolicies: [playbook.actionPolicies[1]],
  }, branchedSteps, {
    id: "lead-5", full_name: "Qualified Buyer", budget_min: 150000,
    qualification: { confidence: 0.93 },
  });
  assert.equal(result.rules[0].route, "true");
  assert.equal(result.actions[0].preview, "not_selected_by_rule");
});

test("canonical corrected lead fields override stale raw enquiry values", () => {
  const result = replayPlaybookAgainstLead(playbook, steps, {
    id: "lead-6", full_name: "Corrected Buyer", budget_min: 50000,
    raw_enquiry: { budget_min: 250000 },
    qualification: { confidence: 0.93 },
  });
  assert.equal(result.rules[0].outcome, "not_matched");
  assert.equal(result.rules[0].route, "false");
});
