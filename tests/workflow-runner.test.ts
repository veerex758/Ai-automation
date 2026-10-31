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


test("Quick Setup enquiry maps manual message through Gemini into Slack", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "trigger-1", nodeId: "manual", operationId: "start", kind: "trigger", input: { message: "I need pricing and next steps." } },
      { id: "gemini-1", nodeId: "gemini", operationId: "generate_text", kind: "action", input: {
        prompt: "Summarize this enquiry: {{trigger-1.message}}",
        model: "gemini-2.5-flash",
        maxOutputTokens: 500,
      } },
      { id: "slack-1", nodeId: "slack", operationId: "send_message", kind: "action", input: {
        message: "New enquiry summary: {{gemini-1.text}}",
      } },
    ],
    context: {
      credentials: {
        gemini: { apiKey: "test-gemini-key" },
        slack: { webhookUrl: "https://hooks.slack.com/services/T000/B000/secret" },
      },
      logger: { info() {}, error() {} },
      http: { async request(args) {
        requests.push({ url: args.url, body: args.body });
        if (args.url.includes("generativelanguage.googleapis.com")) {
          assert.match(JSON.stringify(args.body), /I need pricing and next steps/);
          return { status: 200, body: { modelVersion: "gemini-2.5-flash", candidates: [{ content: { parts: [{ text: "Customer requests pricing and a clear next step." }] } }] } };
        }
        return { status: 200, body: "ok" };
      } },
    },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "succeeded"]);
  assert.equal((result.outputs["trigger-1"] as { message: string }).message, "I need pricing and next steps.");
  assert.equal((result.outputs["gemini-1"] as { text: string }).text, "Customer requests pricing and a clear next step.");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://hooks.slack.com/services/T000/B000/secret");
  assert.deepEqual(requests[1].body, { text: "New enquiry summary: Customer requests pricing and a clear next step." });
});

test("Quick Setup safe preview simulates manual, Gemini and Slack without provider calls", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "trigger-1", nodeId: "manual", operationId: "start", kind: "trigger", input: { message: "Example enquiry" } },
      { id: "gemini-1", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Summarize {{trigger-1.message}}", model: "gemini-2.5-flash", maxOutputTokens: 500 } },
      { id: "slack-1", nodeId: "slack", operationId: "send_message", kind: "action", input: { message: "{{gemini-1.text}}" } },
    ],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: {} }; } } },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["simulated", "simulated", "simulated"]);
  assert.equal(calls, 0);
});
