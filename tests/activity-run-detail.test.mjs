import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const endpointPath = fileURLToPath(new URL("../app/api/activity/[runId]/route.ts", import.meta.url));
const pagePath = fileURLToPath(new URL("../app/dashboard/activity/[runId]/page.tsx", import.meta.url));
const listPagePath = fileURLToPath(new URL("../app/dashboard/activity/page.tsx", import.meta.url));

const [endpoint, detailPage, listPage] = await Promise.all([
  readFile(endpointPath, "utf8"),
  readFile(pagePath, "utf8"),
  readFile(listPagePath, "utf8"),
]);

test("run detail endpoint requires authentication and validates UUIDs", () => {
  assert.match(endpoint, /supabase\.auth\.getUser\(\)/);
  assert.match(endpoint, /status: 401/);
  assert.match(endpoint, /Invalid run identifier\./);
  assert.match(endpoint, /status: 400/);
});

test("run detail and step queries are scoped to the user's workspace", () => {
  assert.match(endpoint, /\.eq\("id", runId\)\s*\.eq\("workspace_id", workspace\.id\)/);
  assert.match(endpoint, /\.eq\("run_id", run\.id\)\s*\.eq\("workspace_id", workspace\.id\)/);
  assert.match(endpoint, /status: 404/);
});

test("run detail returns step metadata without step results or inputs", () => {
  assert.match(endpoint, /step_id, position, step_type, title, status, started_at, completed_at/);
  assert.doesNotMatch(endpoint, /\.select\([^\n]*(result|input|payload|secret)/i);
  assert.match(endpoint, /Cache-Control.*private, no-store/);
});

test("run detail page shows summary, recorded steps, and safe empty/error states", () => {
  assert.match(detailPage, /Recorded steps/);
  assert.match(detailPage, /No step-level records were saved/);
  assert.match(detailPage, /Run details unavailable/);
  assert.match(detailPage, /Try again/);
  assert.match(detailPage, /reloadKey/);
  assert.match(detailPage, /Inputs, outputs, and secret values are intentionally excluded/);
});

test("activity rows link to the detail page", () => {
  assert.match(listPage, /\/dashboard\/activity\/\$\{run\.id\}/);
});


test("run detail renders in-progress and skipped states neutrally", async () => {
  assert.match(detailPage, /function statusTone\(status: string\)/);
  assert.match(detailPage, /return "neutral"/);
  assert.match(detailPage, /startedAt: string \| null/);
  assert.match(detailPage, /if \(!value\) return "In progress"/);
  assert.match(await readFile(fileURLToPath(new URL("../app/dashboard/activity/[runId]/run-detail.css", import.meta.url)), "utf8"), /run-detail-status\.neutral/);
});
