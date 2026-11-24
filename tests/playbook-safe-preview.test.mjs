import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../app/api/real-estate/playbooks/replay/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/dashboard/playbooks/[playbookId]/preview/page.tsx", import.meta.url), "utf8");

test("Safe Preview loads the immutable workflow version and workspace-owned enquiries", () => {
  assert.match(api, /workflow_versions/);
  assert.match(api, /\.eq\("version", input\.version\)/);
  assert.match(api, /\.eq\("workspace_id", workspace\.id\)/);
  assert.match(api, /\.in\("id", input\.leadIds/);
});

test("Safe Preview is bounded and rejects duplicate or malformed lead IDs", () => {
  assert.match(api, /input\.leadIds\.length > 50/);
  assert.match(api, /new Set\(input\.leadIds\)\.size !== input\.leadIds\.length/);
  assert.match(api, /uuid\.test\(id\)/);
});

test("Safe Preview uses a pure replay evaluator and never dispatches a provider or workflow", () => {
  assert.match(api, /replayPlaybookAgainstLead/);
  assert.match(api, /sideEffects: false/);
  assert.match(api, /providerCalls: 0/);
  assert.match(api, /writes: 0/);
  assert.doesNotMatch(api, /processRealEstateLeadPipeline|executeRegisteredOperation|fetch\("https?:/);
});

test("Safe Preview UI states the side-effect-free boundary and uses selected sample", () => {
  assert.match(page, /Read-only preview/);
  assert.match(page, /does not call Gemini, Resend/);
  assert.match(page, /maximum 50 enquiries/i);
  assert.match(page, /workflowId: playbookId, version: workflow\.version, leadIds: selected/);
  assert.match(page, /Run Safe Preview/);
});
