import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRegisteredWorkflow } from "../nodes/workflow-runner";

const context = {
  credentials: { openai: { apiKey: "test-only-key" } },
  logger: { info() {}, error() {} },
  http: { async request() { return { status: 200, body: { output_text: "Generated text", model: "gpt-4o-mini" } }; } },
};


test("registry runner awaits durable start and completion checkpoints around each action", async () => {
  const events: string[] = [];
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context,
    dryRun: false,
    async onStepStart(step, position) { events.push(`start:${position}:${step.id}`); },
    async onStepComplete(step, position, completed) {
      events.push(`complete:${position}:${step.id}:${completed.status}`);
    },
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(events, ["start:1:draft", "complete:1:draft:succeeded"]);
});

test("registry runner does not call a provider when its start checkpoint fails", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: { output_text: "should not execute" } }; } } },
    dryRun: false,
    async onStepStart() { throw new Error("CHECKPOINT_WRITE_FAILED"); },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].error, "CHECKPOINT_WRITE_FAILED");
  assert.equal(calls, 0);
});

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

test("registry workflow validates and executes explicit branch selection", async () => {
  const { validateRegisteredSteps } = await import("../nodes/validate-steps");
  const raw = [
    { id: "manual", nodeId: "manual", operationId: "start", kind: "trigger", input: {} },
    { id: "condition", nodeId: "if", operationId: "evaluate", kind: "action", input: { value: "approved", operator: "equals", compareTo: "approved" } },
    { id: "yes", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { route: "approved" } }, branch: { fromStepId: "condition", route: "true" } },
    { id: "no", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { route: "rejected" } }, branch: { fromStepId: "condition", route: "false" } },
  ];
  const validated = validateRegisteredSteps(raw);
  assert.ok(validated.steps);
  const result = await executeRegisteredWorkflow({ steps: validated.steps, context, dryRun: false });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "succeeded", "skipped"]);
  assert.equal(validateRegisteredSteps([raw[0], { ...raw[2], branch: { fromStepId: "later", route: "true" } }]).error, "Branch source must be an earlier IF or Switch step.");
});


test("loop metadata executes a downstream registered operation once per source item", async () => {
  const calls: string[] = [];
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "manual", nodeId: "manual", operationId: "start", kind: "trigger", input: {} },
      { id: "items", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { items: ["alpha", "beta", "gamma"] } } },
      { id: "each", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { value: "{{loop_item}}", index: "{{loop_index}}" } }, loop: { sourceStepId: "items", maxIterations: 10 } },
    ],
    context: { ...context, http: { async request() { calls.push("request"); return { status: 200, body: {} }; } } },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputs.each, [
    { data: { value: "alpha", index: "0" } },
    { data: { value: "beta", index: "1" } },
    { data: { value: "gamma", index: "2" } },
  ]);
});


test("loop metadata executes multiple downstream steps per source item", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "manual", nodeId: "manual", operationId: "start", kind: "trigger", input: {} },
      { id: "items", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { items: ["alpha", "beta", "gamma"] } } },
      { id: "each", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { value: "{{loop_item}}", index: "{{loop_index}}" } }, loop: { sourceStepId: "items", maxIterations: 10 } },
      { id: "decorate", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { label: "item-{{each.data.value}}", index: "{{each.data.index}}" } }, loop: { sourceStepId: "items", maxIterations: 10 } },
    ],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputs.decorate, [
    { data: { label: "item-alpha", index: "0" } },
    { data: { label: "item-beta", index: "1" } },
    { data: { label: "item-gamma", index: "2" } },
  ]);
});


test("Wait pauses the runner and resumes after its persisted checkpoint", async () => {
  const steps = [
    { id: "manual", nodeId: "manual", operationId: "start", kind: "trigger" as const, input: {} },
    { id: "delay", nodeId: "wait", operationId: "delay", kind: "action" as const, input: { durationMs: 1000 } },
    { id: "after", nodeId: "set_fields", operationId: "merge_fields", kind: "action" as const, input: { data: {}, fields: { resumedAt: "{{delay.resumeAt}}" } } },
  ];
  const checkpointOutputs: Record<string, unknown> = {};
  const first = await executeRegisteredWorkflow({
    steps, context, dryRun: false,
    async onStepComplete(step, _position, completed) {
      if (completed.status === "succeeded") checkpointOutputs[step.id] = completed.output;
    },
  });
  assert.equal(first.status, "waiting");
  assert.ok(typeof first.resumeAt === "string");
  assert.equal(first.steps.some((step) => step.stepId === "after"), false);
  const resumed = await executeRegisteredWorkflow({
    steps, context, dryRun: false,
    initialOutputs: checkpointOutputs,
    completedStepIds: ["manual", "delay"],
  });
  assert.equal(resumed.status, "succeeded");
  assert.equal((resumed.outputs.after as { data: { resumedAt: string } }).data.resumedAt, checkpointOutputs.delay && (checkpointOutputs.delay as { resumeAt: string }).resumeAt);
});
