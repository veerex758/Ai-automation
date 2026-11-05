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

test("Loop executes its registered downstream actions once per item with isolated outputs", async () => {
  const prompts: string[] = [];
  const result = await executeRegisteredWorkflow({
    steps: [{
      id: "batch",
      nodeId: "loop",
      operationId: "each",
      kind: "action",
      input: {
        items: ["alpha", "beta"],
        bodySteps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", input: { prompt: "Summarize {{item}}" } }],
      },
    }],
    context: {
      ...context,
      http: { async request(args) {
        const body = args.body as { input?: string };
        const prompt = body.input ?? "";
        prompts.push(prompt);
        return { status: 200, body: { output_text: "result:" + prompt, model: "test-model" } };
      } },
    },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(prompts, ["Summarize alpha", "Summarize beta"]);
  const loopOutput = result.outputs.batch as { iterations: number; results: Array<{ index: number; outputs: Record<string, unknown> }> };
  assert.equal(loopOutput.iterations, 2);
  assert.equal(loopOutput.results[0].index, 0);
  assert.equal(loopOutput.results[1].index, 1);
  assert.ok(loopOutput.results[0].outputs.draft);
  assert.ok(loopOutput.results[1].outputs.draft);
});

test("Loop dry-run validates nested registered actions without executing them", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [{
      id: "batch",
      nodeId: "loop",
      operationId: "each",
      kind: "action",
      input: { items: ["alpha"], bodySteps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", input: { prompt: "Summarize {{item}}" } }] },
    }],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: {} }; } } },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps[0].status, "simulated");
  assert.equal(calls, 0);
});

test("Loop rejects unknown nested operations during dry-run validation", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [{
      id: "batch",
      nodeId: "loop",
      operationId: "each",
      kind: "action",
      input: { items: ["alpha"], bodySteps: [{ id: "bad", nodeId: "missing", operationId: "unknown", input: {} }] },
    }],
    context,
    dryRun: true,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].error, "LOOP_BODY_OPERATION_NOT_FOUND");
});
