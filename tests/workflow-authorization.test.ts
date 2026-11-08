import test from "node:test";
import assert from "node:assert/strict";
import { executeRegisteredWorkflow } from "../nodes/workflow-runner";
import type { NodeContext } from "../nodes/types";

test("live worker authorization is awaited immediately before a provider handler", async () => {
  let authorizationCalls = 0;
  let externalCalls = 0;
  const context: Omit<NodeContext, "previousOutputs"> = {
    credentials: { openai: { apiKey: "test-only" } },
    logger: { info() {}, error() {} },
    http: { async request() { externalCalls++; return { status: 200, body: {} }; } },
    authorizeOperation: async ({ nodeId, operationId, kind }) => {
      authorizationCalls++;
      assert.deepEqual({ nodeId, operationId, kind }, { nodeId: "openai", operationId: "generate_text", kind: "action" });
      throw new Error("WORKSPACE_PROVIDER_OPERATION_NOT_APPROVED");
    },
  };
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "step-1", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "test" } }],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].error, "WORKSPACE_PROVIDER_OPERATION_NOT_APPROVED");
  assert.equal(authorizationCalls, 1);
  assert.equal(externalCalls, 0);
});
