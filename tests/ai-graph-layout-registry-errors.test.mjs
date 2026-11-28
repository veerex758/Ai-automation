import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateGraphPositions } from "../lib/workflows/graph-layout.cjs";

test("generated graphs with the maximum supported depth stay inside editor coordinate bounds", () => {
  const steps = Array.from({ length: 30 }, (_, index) => ({ id: "step-" + index }));
  const edges = steps.slice(1).map((step, index) => ({
    id: "edge-" + index,
    source: steps[index].id,
    target: step.id,
    label: "next",
  }));
  const positions = calculateGraphPositions(steps, edges);
  assert.equal(positions.size, 30);
  for (const position of positions.values()) {
    assert.ok(Number.isFinite(position.x) && position.x >= 0 && position.x <= 2000);
    assert.ok(Number.isFinite(position.y) && position.y >= 0 && position.y <= 2000);
  }
  assert.equal(positions.get("step-0").x, 160);
  assert.equal(positions.get("step-29").x, 2000);
});

test("generated IF branches receive bounded upper and lower lanes", () => {
  const steps = ["start", "qualify", "if", "yes", "no"].map((id) => ({ id }));
  const edges = [
    { id: "e1", source: "start", target: "qualify", label: "next" },
    { id: "e2", source: "qualify", target: "if", label: "next" },
    { id: "e3", source: "if", target: "yes", label: "true" },
    { id: "e4", source: "if", target: "no", label: "false" },
  ];
  const positions = calculateGraphPositions(steps, edges);
  assert.ok(positions.get("yes").y < positions.get("if").y);
  assert.ok(positions.get("no").y > positions.get("if").y);
  for (const position of positions.values()) {
    assert.ok(position.x >= 0 && position.x <= 2000);
    assert.ok(position.y >= 0 && position.y <= 2000);
  }
});

test("AI API rejects unknown nodes and revalidates one bounded schema repair before metering", () => {
  const route = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
  assert.match(route, /AI_NODE_NOT_REGISTERED/);
  assert.match(route, /AI_NODE_INPUT_INVALID/);
  assert.match(route, /repairRegistryStepInputs/);
  assert.match(route, /if \\(invalidInputs\\.length\\)/);
  assert.match(route, /operation\\.inputSchema\\.safeParse\\(repairedInput\\)/);
  assert.match(route, /AI_NODE_INPUT_REPAIR_FAILED/);
  assert.match(route, /findOperation\\(step\\.nodeId, step\\.operationId/);
  assert.match(route, /inputValidation\\.error\\.issues/);
  assert.match(route, /calculateGraphPositions/);
  assert.doesNotMatch(route, /x: 160 \\+ depth \\* 320/);

  const validationIndex = route.indexOf("operation.inputSchema.safeParse(repairedInput)");
  const meteringIndex = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  assert.ok(validationIndex > 0 && meteringIndex > validationIndex,
    "AI credit metering must remain after repaired input is schema-validated");
});
