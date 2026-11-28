import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/page.tsx", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../app/dashboard/ai-assistant/page.tsx", import.meta.url), "utf8");
const brand = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/graph-node-brand.tsx", import.meta.url), "utf8");
const builderCss = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/builder.css", import.meta.url), "utf8");
const brandAssets = readFileSync(new URL("../lib/integrations/official-brand-assets.ts", import.meta.url), "utf8");
const integrationsDirectory = readFileSync(new URL("../app/dashboard/registry-integrations-directory.tsx", import.meta.url), "utf8");


test("visual graph canvas supports zoom, fit-to-view, background pan, and scale-aware node dragging", () => {
  assert.match(page, /const fitGraphToView = useCallback\(/);
  assert.match(page, /function resolvePosition\(node: WorkflowNode, index: number/);
  assert.match(page, /const contentWidth = Math\.max\(180, right - left\)/);
  assert.match(page, /const availableHeight = Math\.max\(160, bounds\.height - 64\)/);
  assert.match(page, /function zoomGraphTo\(/);
  assert.match(page, /onWheel=\{handleGraphWheel\}/);
  assert.match(page, /onPointerDown=\{beginGraphPan\}/);
  assert.match(page, /onPointerMove=\{moveGraphPan\}/);
  assert.match(page, /aria-label="Fit graph to view"/);
  assert.match(page, /transform: `translate\(\$\{camera\.x\}px, \$\{camera\.y\}px\) scale\(\$\{camera\.scale\}\)`/);
  assert.match(page, /\(event\.clientX - drag\.startX\) \/ camera\.scale/);
  assert.match(page, /<GraphNodeBrand/);
  assert.match(page, /<strong className="graph-node-operation">\{node\.title\}<\/strong>/);
  assert.match(page, /className="graph-node-face"/);
  assert.match(page, /className="graph-node-port graph-port-in"/);
  assert.match(page, /className="graph-node-port graph-port-out"/);
  assert.match(page, /const sx = source\.x \+ 40/);
  assert.match(page, /const tx = target\.x - 40/);
  assert.match(page, /edge\.label === "true" \? "TRUE" : "FALSE"/);
});


test("canvas nodes reuse official provider logos for major integrations and common provider catalogue entries", () => {
  for (const provider of ["gmail", "sheets", "google_sheets", "slack", "gemini", "postgresql", "mysql", "mongodb", "supabase", "resend"]) {
    assert.ok(brandAssets.includes('"' + provider + '"'), "missing brand mapping: " + provider);
  }
  assert.match(brand, /cdn\.simpleicons\.org/);
  assert.match(brand, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(brand, /PrimitiveMark/);
  assert.match(brand, /providerId === "email" \? officialBrandAssets\.resend/);
  assert.match(brand, /draggable=\{false\}/);
});

test("Builder and Integrations directory consume one shared 86-provider official brand catalogue", () => {
  assert.match(brand, /import \{ officialBrandAssets \} from "@\/lib\/integrations\/official-brand-assets"/);
  assert.match(integrationsDirectory, /import \{ officialBrandAssets \} from "@\/lib\/integrations\/official-brand-assets"/);
  assert.match(brandAssets, /export const officialBrandAssets/);
  assert.equal((brandAssets.match(/"slug":/g) || []).length, 86);
  assert.doesNotMatch(integrationsDirectory, /const officialBrandAssets/);
  assert.match(brand, /providerId === "email" \? officialBrandAssets\.resend/);
});

test("canvas nodes use compact square brand tiles, operation captions, real connection ports and clean branch styles", () => {
  assert.match(builderCss, /\.graph-node-face[\s\S]*?width:80px/);
  assert.match(builderCss, /\.graph-node-brand img[\s\S]*?object-fit:contain/);
  assert.match(builderCss, /\.graph-node-operation[\s\S]*?text-align:center/);
  assert.match(builderCss, /\.graph-port-in/);
  assert.match(builderCss, /\.graph-port-out/);
  assert.match(builderCss, /\.graph-edge-true path\{stroke:#67D5A1/);
  assert.match(builderCss, /\.graph-edge-false path\{stroke:#F0AD79/);
});

test("workflow builder maps validated registry generation steps onto editable graph nodes", () => {
  assert.match(page, /registrySteps\?: Array</);
  assert.match(page, /const steps = Array\.isArray\(payload\.registrySteps\) \? payload\.registrySteps : \[\]/);
  assert.match(page, /registryNodeId: step\.nodeId/);
  assert.match(page, /registryOperationId: step\.operationId/);
  assert.match(page, /registryInput: step\.input/);
  assert.match(page, /title: operation\?\.name \|\| provider\?\.name \|\| step\.operationId/);
});

test("workflow builder preserves generated step order as explicit editable graph edges", () => {
  assert.match(page, /edges: steps\.slice\(1\)\.map/);
  assert.match(page, /source: steps\[index\]\.id/);
  assert.match(page, /target: step\.id/);
  assert.match(page, /label: "next" as const/);
});

test("legacy AI Assistant authoring redirects into outcome-first Playbook setup", () => {
  assert.match(assistant, /redirect\("\/dashboard\/playbooks\/new"\)/);
  assert.doesNotMatch(assistant, /Generate on visual canvas|REXNORA AI WORKFLOW DESIGNER/);
});

test("AI-generated graph drafts remain review-only and are not auto-executed", () => {
  assert.match(page, /Review and edit it, then Save workflow; it has not been executed\./);
  assert.match(page, /async function saveDefinition\(\)/);
  assert.match(page, /async function activateWorkflow\(\)/);
});


test("AI draft retry is an explicit user action and reuses the saved prompt", () => {
  assert.match(page, /aiDraftRetryPrompt/);
  assert.match(page, /aiDraftRetryable/);
  assert.match(page, /generateDraftOnCanvas\(retryPrompt\?: string\)/);
  assert.match(page, /generateDraftOnCanvas\(aiDraftRetryPrompt\)/);
  assert.match(page, /Retry AI draft/);
  assert.match(page, /disabled=\{aiDraftGenerating\}/);
  assert.match(page, /setAiDraftRetryPrompt\(prompt\)/);
  assert.match(page, /setAiDraftRetryPrompt\(""\)/);
});
