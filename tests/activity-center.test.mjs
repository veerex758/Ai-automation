import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const endpointPath = fileURLToPath(new URL("../app/api/activity/route.ts", import.meta.url));
const pagePath = fileURLToPath(new URL("../app/dashboard/activity/page.tsx", import.meta.url));

const [endpoint, page] = await Promise.all([
  readFile(endpointPath, "utf8"),
  readFile(pagePath, "utf8"),
]);

test("activity endpoint requires an authenticated user", () => {
  assert.match(endpoint, /supabase\.auth\.getUser\(\)/);
  assert.match(endpoint, /Authentication required\./);
  assert.match(endpoint, /status: 401/);
});

test("activity endpoint scopes run reads to the default workspace and bounds results", () => {
  assert.match(endpoint, /getOrCreateDefaultWorkspace\(supabase, user\)/);
  assert.match(endpoint, /\.eq\("workspace_id", workspace\.id\)/);
  assert.match(endpoint, /\.limit\(limit\)/);
  assert.match(endpoint, /const limit = 50/);
});

test("activity response exposes metadata only and disables caching", () => {
  assert.match(endpoint, /workflow_version, created_at, duration_ms/);
  assert.match(endpoint, /Cache-Control.*private, no-store/);
  assert.doesNotMatch(endpoint, /\.select\([^\n]*(input|secret|payload)/i);
  assert.doesNotMatch(endpoint, /run\.input|run\.payload|run\.error_message/);
});

test("activity UI supports status filtering and links runs to their builder", () => {
  assert.match(page, /\["succeeded","Succeeded"\]/);
  assert.match(page, /\["failed","Failed"\]/);
  assert.match(page, /\/dashboard\/workflows\/\$\{run\.workflowId\}/);
  assert.match(page, /No workflow runs yet/);
});
