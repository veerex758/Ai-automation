import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("workflow lifecycle E2E is manual, staging-only and dry-run safe", async () => {
  const workflow = await readFile(new URL("../.github/workflows/workflow-lifecycle-e2e.yml", import.meta.url), "utf8");
  const spec = await readFile(new URL("../e2e/workflow-lifecycle.spec.ts", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /vars\.AIVANTA_E2E_BASE_URL/);
  assert.match(workflow, /secrets\.AIVANTA_E2E_EMAIL/);
  assert.match(workflow, /secrets\.AIVANTA_E2E_PASSWORD/);
  assert.match(spec, /target\.protocol !== "https:"/);
  assert.match(spec, /dryRun: true/);
  assert.match(spec, /sideEffectsPerformed\)\.toBe\(false\)/);
  assert.match(spec, /activation\.status\(\)\)\.toBe\(422\)/);
  assert.doesNotMatch(spec, /AIVANTA_LIVE_EXECUTION_ENABLED/);
});
