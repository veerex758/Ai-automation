import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workflows/route.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../app/dashboard/builder/page.tsx", import.meta.url), "utf8");

test("workflow creation validates and persists an included definition in the same insert", () => {
  assert.match(route, /import \{ validateDefinition \} from "@\/lib\/workflows\/validate-definition\.cjs";/);
  assert.match(route, /"definition" in body\s*\? validateDefinition\(body\.definition\)/);
  assert.match(route, /status: 422/);
  assert.match(route, /definition: definitionResult\.definition/);
});

test("quick-create and template creation receive a valid manual-trigger starter definition", () => {
  assert.match(route, /: validateDefinition\(\{\s*version: 1,\s*nodes: \[\{\s*id: "trigger-1",\s*type: "trigger",[\s\S]*?settings: \{ event: "manual" \}/);
  assert.match(route, /definition: definitionResult\.definition/);
});

test("builder sends a new workflow definition with creation and only patches existing drafts", () => {
  assert.match(builder, /const isNewWorkflow = !workflowId;/);
  assert.match(builder, /status: "draft",\s*definition,/);
  assert.match(builder, /if \(!isNewWorkflow\)\s*\{\s*const saveResponse = await fetch\(\`\/api\/workflows\/\$\{workflowId\}\/definition\`/);
  assert.match(builder, /Workflow draft saved to your Aivanta workspace/);
  assert.match(builder, /It has not been activated or executed/);
});
