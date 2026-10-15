import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const endpointPath = fileURLToPath(new URL("../app/api/activity/route.ts", import.meta.url));
const pagePath = fileURLToPath(new URL("../app/dashboard/activity/page.tsx", import.meta.url));
const builderPath = fileURLToPath(new URL("../app/dashboard/workflows/[workflowId]/page.tsx", import.meta.url));

const [endpoint, page, builder] = await Promise.all([
  readFile(endpointPath, "utf8"),
  readFile(pagePath, "utf8"),
  readFile(builderPath, "utf8"),
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

test("activity UI supports status filtering and links runs to secure detail pages", () => {
  assert.match(page, /\["succeeded","Succeeded"\]/);
  assert.match(page, /\["failed","Failed"\]/);
  assert.match(page, /\/dashboard\/activity\/\$\{run\.id\}/);
  assert.match(page, /No workflow runs yet/);
});

test("activity response includes workspace context without exposing run payloads", () => {
  assert.match(endpoint, /workspace:\s*\{\s*id: workspace\.id, name: workspace\.name\s*\}/);
  assert.match(page, /setWorkspaceName\(result\.workspace\.name\.trim\(\)\)/);
});

test("activity UI searches workflow names and run identifiers", () => {
  assert.match(page, /type="search"/);
  assert.match(page, /`\$\{run\.workflowName\} \$\{run\.id\} \$\{run\.workflowId\}`\.toLowerCase\(\)\.includes\(query\)/);
  assert.match(page, /matchesStatus && matchesSearch/);
});

test("workflow builder links to activity without silently discarding unsaved edits", () => {
  assert.match(builder, /href="\/dashboard\/activity"/);
  assert.match(builder, /unsaved workflow changes\. Leave this page and discard them\?/);
});

test("activity duration rendering tolerates missing or invalid values", () => {
  assert.match(page, /function formatDuration\(value: number \| null\)/);
  assert.match(page, /typeof value !== "number" \|\| !Number\.isFinite\(value\)/);
  assert.match(page, /formatDuration\(run\.durationMs\)/);
});
