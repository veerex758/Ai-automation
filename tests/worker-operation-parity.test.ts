import test from "node:test";
import assert from "node:assert/strict";
import { nodes } from "../nodes/registry";
import { getWorkerOperationMapping, WORKER_OPERATION_MAP } from "../lib/workflows/worker-operation-map";

test("every registered trigger and action has exactly one worker provider mapping", () => {
  const registered = nodes.flatMap((node) => [
    ...node.triggers.map((operation) => ({ kind: "trigger" as const, nodeId: node.id, operationId: operation.id })),
    ...node.actions.map((operation) => ({ kind: "action" as const, nodeId: node.id, operationId: operation.id })),
  ]);
  assert.equal(new Set(registered.map((item) => item.kind + ":" + item.nodeId + ":" + item.operationId)).size, registered.length,
    "registry operation identifiers must be unique");
  assert.equal(WORKER_OPERATION_MAP.size, registered.length, "worker mapping count must match registry operation count");
  for (const operation of registered) {
    const mapping = getWorkerOperationMapping(operation);
    assert.ok(mapping, "missing worker mapping: " + operation.kind + " " + operation.nodeId + "." + operation.operationId);
    const definition = nodes.find((node) => node.id === operation.nodeId)!;
    const expectedProvider = definition.auth.type === "none" ? null
      : operation.nodeId === "email" ? "resend"
      : operation.nodeId === "google_sheets" ? "sheets"
      : operation.nodeId === "http_request" ? "http"
      : operation.nodeId;
    assert.equal(mapping.provider, expectedProvi¶»§q«^