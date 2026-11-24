import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../app/api/real-estate/playbooks/ledger/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/dashboard/playbooks/[playbookId]/ledger/page.tsx", import.meta.url), "utf8");

test("Outcome Ledger reads only leads and activities bound to this workspace and Playbook", () => {
  assert.match(api, /\.eq\("workspace_id", workspace\.id\)/);
  assert.match(api, /\.eq\("workflow_id", workflowId\)/);
  assert.match(api, /real_estate_lead_activities/);
  assert.match(api, /real_estate_followups/);
});

test("Outcome Ledger is read-only and does not mutate activity or delivery history", () => {
  assert.doesNotMatch(api, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.match(page, /read-only/);
  assert.match(page, /append-only/);
});

test("Outcome Ledger displays activity explanations and delivery state", () => {
  assert.match(page, /Enquiry activity/);
  assert.match(page, /Follow-up delivery/);
  assert.match(page, /event\.details/);
  assert.match(page, /item\.status/);
});
