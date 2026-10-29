import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRegisteredWorkflow } from "../nodes/workflow-runner";

const context = {
  credentials: { openai: { apiKey: "test-only-key" } },
  logger: { info() {}, error() {} },
  http: { async request() { return { status: 200, body: { output_text: "Generated text", model: "gpt-4o-mini" } }; } },
};

test("registry workflow dry-run validates registered steps without calling providers", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: {} }; } } },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps[0].status, "simulated");
  assert.equal(calls, 0);
});

test("registry workflow stores validated operation outputs for later steps", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps[0].status, "succeeded");
  assert.equal((result.outputs.draft as { text: string }).text, "Generated text");
});


test("workflow references preserve exact numeric and object types", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "numbers", nodeId: "data", operationId: "aggregate_numbers", kind: "action", input: { values: [3, 4, 5] } },
      { id: "condition", nodeId: "logic", operationId: "condition", kind: "action", input: { left: "{{numbers.sum}}", operator: "equals", right: 12 } },
      { id: "mapped", nodeId: "data", operationId: "map_fields", kind: "action", input: { data: { name: "Ada", score: 12 }, fields: { customer: "name", score: "score" } } },
      { id: "remapped", nodeId: "data", operationId: "map_fields", kind: "action", input: { data: "{{mapped.data}}", fields: { customer: "customer", score: "score" } } },
    ],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputs.condition, { result: true });
  assert.deepEqual(result.outputs.remapped, { data: { customer: "Ada", score: 12 } });
});

test("registry workflow stops after a failed registered operation", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "bad", nodeId: "unknown", operationId: "missing", kind: "action", input: {} },
      { id: "later", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Should not run" } },
    ],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].error, "NODE_OPERATION_NOT_FOUND");
  assert.equal(result.steps[1].status, "skipped");
});

test("registry workflow dry-run accepts previous-step references without provider calls", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } },
      { id: "rewrite", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Rewrite this: {{draft.text}}" } },
    ],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: {} }; } } },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].status, "simulated");
  assert.equal(calls, 0);
});

test("OpenAI output can feed Slack and Email in one registry workflow", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Write a concise appointment reminder" } },
      { id: "slackNotice", nodeId: "slack", operationId: "send_message", kind: "action", input: { message: "Reminder draft: {{draft.text}}" } },
      { id: "emailNotice", nodeId: "email", operationId: "send_email", kind: "action", input: { to: "recipient@example.com", subject: "Appointment reminder", text: "{{draft.text}}" } },
    ],
    context: {
      credentials: {
        openai: { apiKey: "test-only-key" },
        slack: { webhookUrl: "https://hooks.slack.com/services/T000/B000/secret" },
        resend: { apiKey: "test-only-key", fromEmail: "test@example.com" },
      },
      logger: { info() {}, error() {} },
      http: { async request(args) {
        requests.push({ url: args.url, body: args.body });
        if (args.url === "https://api.openai.com/v1/responses") return { status: 200, body: { output_text: "Your appointment is tomorrow at 10 AM.", model: "gpt-4o-mini", usage: { input_tokens: 10, output_tokens: 8 } } };
        if (args.url === "https://api.resend.com/emails") return { status: 200, body: { id: "email_test_123" } };
        return { status: 200, body: "ok" };
      } },
    },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "succeeded"]);
  assert.equal(requests.length, 3);
  assert.equal((requests[1].body as { text: string }).text, "Reminder draft: Your appointment is tomorrow at 10 AM.");
  assert.equal((requests[2].body as { text: string }).text, "Your appointment is tomorrow at 10 AM.");
});

test("registry dry-run simulates Slack and Email without calling their providers", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "slackNotice", nodeId: "slack", operationId: "send_message", kind: "action", input: { message: "Hello" } },
      { id: "emailNotice", nodeId: "email", operationId: "send_email", kind: "action", input: { to: "recipient@example.com", subject: "Hello", text: "Hello" } },
    ],
    context: {
      credentials: { slack: { webhookUrl: "https://hooks.slack.com/services/T000/B000/secret" }, resend: { apiKey: "test-only-key", fromEmail: "test@example.com" } },
      logger: { info() {}, error() {} },
      http: { async request() { calls++; return { status: 200, body: {} }; } },
    },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["simulated", "simulated"]);
  assert.equal(calls, 0);
});

test("Switch / Route runs only steps attached to the selected route", async () => {
  const calls: string[] = [];
  const result = await executeRegisteredWorkflow({
    steps: [
      {
        id: "routeLead", nodeId: "logic", operationId: "switch", kind: "action",
        input: { value: "qualified", cases: [{ value: "new", route: "new_lead" }, { value: "qualified", route: "qualified_lead" }], defaultRoute: "review" },
      },
      {
        id: "newPath", nodeId: "data", operationId: "format_text", kind: "action",
        input: { template: "new lead", values: {} }, branch: { stepId: "routeLead", route: "new_lead" },
      },
      {
        id: "qualifiedPath", nodeId: "data", operationId: "format_text", kind: "action",
        input: { template: "qualified lead", values: {} }, branch: { stepId: "routeLead", route: "qualified_lead" },
      },
    ],
    context: { ...context, http: { async request() { calls.push("http"); return { status: 200, body: {} }; } } },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps[0].status, "succeeded");
  assert.equal(result.steps[1].status, "skipped");
  assert.equal(result.steps[1].error, "BRANCH_NOT_SELECTED");
  assert.equal(result.steps[2].status, "succeeded");
  assert.equal((result.outputs.qualifiedPath as { text: string }).text, "qualified lead");
  assert.deepEqual(calls, []);
});

test("Switch / Route rejects branch conditions without a valid prior route output", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [{
      id: "branch", nodeId: "data", operationId: "format_text", kind: "action",
      input: { template: "not allowed", values: {} }, branch: { stepId: "missing", route: "go" },
    }],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].error, "WORKFLOW_BRANCH_SOURCE_INVALID");
});
