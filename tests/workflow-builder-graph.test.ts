import test from "node:test";
import assert from "node:assert/strict";
import { buildRegistrySteps } from "../lib/workflows/build-registry-steps";

const trigger = { id: "start", type: "trigger" as const, title: "Manual start", settings: { event: "manual" }, registryNodeId: "manual", registryOperationId: "start", registryInput: {} };
const action = (id: string) => ({ id, type: "action" as const, title: id, settings: {}, registryNodeId: "set_fields", registryOperationId: "merge_fields", registryInput: { data: {}, fields: { result: id } } });

test("linear graph becomes a topologically ordered registered execution plan", () => {
  const steps = buildRegistrySteps({
    nodes: [trigger, action("first"), action("second")],
    edges: [
      { id: "e1", source: "start", target: "first", label: "next" },
      { id: "e2", source: "first", target: "second", label: "next" },
    ],
  });
  assert.deepEqual(steps.map((step) => step.id), ["start", "first", "second"]);
});

test("IF branches become explicit true and false execution paths", () => {
  const condition = {
    id: "condition", type: "condition" as const, title: "Approved?",
    settings: { field: "{{start.payload.approved}}", operator: "equals", value: "yes" },
  };
  const steps = buildRegistrySteps({
    nodes: [trigger, condition, action("approved"), action("rejected")],
    edges: [
      { id: "e1", source: "start", target: "condition", label: "next" },
      { id: "e2", source: "condition", target: "approved", label: "true" },
      { id: "e3", source: "condition", target: "rejected", label: "false" },
    ],
  });
  assert.deepEqual(steps.find((step) => step.id === "approved")?.branchPaths, [[{ fromStepId: "condition", route: "true" }]]);
  assert.deepEqual(steps.find((step) => step.id === "rejected")?.branchPaths, [[{ fromStepId: "condition", route: "false" }]]);
});

test("disconnected nodes and multiple triggers are rejected before persistence", () => {
  assert.throws(() => buildRegistrySteps({ nodes: [trigger, action("orphan")], edges: [] }), /reachable from the trigger/);
  assert.throws(() => buildRegistrySteps({ nodes: [trigger, { ...trigger, id: "second-trigger" }], edges: [] }), /exactly one trigger/);
});

test("invalid branch sources and incomplete conditional branches are rejected", () => {
  assert.throws(() => buildRegistrySteps({
    nodes: [trigger, action("plain"), action("branch")],
    edges: [
      { id: "e1", source: "start", target: "plain", label: "next" },
      { id: "e2", source: "plain", target: "branch", label: "true" },
    ],
  }), /Only IF and Switch nodes/);
  const condition = { id: "condition", type: "condition" as const, title: "Check", settings: { field: "{{start.payload.value}}", operator: "equals", value: "yes" } };
  assert.throws(() => buildRegistrySteps({
    nodes: [trigger, condition, action("yes")],
    edges: [
      { id: "e1", source: "start", target: "condition", label: "next" },
      { id: "e2", source: "condition", target: "yes", label: "true" },
    ],
  }), /true and false paths/);
});

test("cycles, duplicate connection IDs and malformed edges are rejected", () => {
  assert.throws(() => buildRegistrySteps({
    nodes: [trigger, action("a"), action("b")],
    edges: [
      { id: "e1", source: "start", target: "a", label: "next" },
      { id: "e2", source: "a", target: "b", label: "next" },
      { id: "e3", source: "b", target: "a", label: "next" },
    ],
  }), /cannot contain a cycle/);
  assert.throws(() => buildRegistrySteps({
    nodes: [trigger, action("a")],
    edges: [
      { id: "same", source: "start", target: "a", label: "next" },
      { id: "same", source: "start", target: "a", label: "next" },
    ],
  }), /connection IDs must be unique/);
});
