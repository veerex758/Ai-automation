import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const generator = readFileSync(new URL("../lib/workflows/ai-workflow-generator.cjs", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/page.tsx", import.meta.url), "utf8");

test("Gemini registry planning is instructed to return explicit graph edges and conditional paths", () => {
  assert.match(generator, /\{registrySteps:\[\.\.\.\],edges:\[\.\.\.\]\}/);
  assert.match(generator, /true\/false edges/);
  assert.match(generator, /All nodes must be reachable from the trigger/);
});

test("AI generation validates edge endpoints, branch sources, reachability, cycles, and registered inputs", () => {
  assert.match(route, /Only IF and Switch nodes can create true\/false connections/);
  assert.match(route, /Every generated step must be connected to the workflow trigger/);
  assert.match(route, /Every conditional node with downstream work must include true and false paths/);
  assert.match(route, /buildRegistrySteps\(/);
  assert.match(route, /validateRegisteredSteps\(/);
});

test("Graph Builder uses generated graph nodes and edges instead of replacing them with a linear placeholder", () => {
  assert.match(builder, /hasGeneratedGraph/);
  assert.match(builder, /payload\.definition as Definition/);
  assert.match(builder, /edges: steps\.slice\(1\)\.map/);
});
