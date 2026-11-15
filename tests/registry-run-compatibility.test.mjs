import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url), "utf8");
const runsRoute = await readFile(new URL("../app/api/workflows/[workflowId]/runs/route.ts", import.meta.url), "utf8");
const marketplace = await readFile(new URL("../app/api/marketplace/installations/[installationId]/lifecycle/route.ts", import.meta.url), "utf8");

test("legacy registry-run URL remains a dry-run-compatible alias", () => {
  assert.match(route, /export \{ GET, POST \} from ["']\.\.\/runs\/route["']/);
  assert.match(runsRoute, /sideEffectsPerformed: false/);
  assert.match(runsRoute, /requestBody\.mode !== undefined && requestBody\.mode !== "dry_run"/);
});

test("Marketplace installation dry-run keeps its existing endpoint contract", () => {
  assert.match(marketplace, /\/api\/workflows\/["']\s*\+\s*i\.workflow_id\s*\+\s*["']\/registry-run/);
  assert.match(marketplace, /result\?\.run\?\.status\s*!==\s*"succeeded"/);
});
