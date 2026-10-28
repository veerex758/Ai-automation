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
