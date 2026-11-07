import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");

test("saving or replacing workspace credentials revokes prior successful connection readiness", () => {
  assert.match(route, /status: "needs_attention", last_tested_at: null, last_test_status: null/);
  assert.match(route, /Revoke readiness before replacing a saved secret/);
  assert.match(route, /Replacing a secret invalidates any previous successful test/);
  assert.match(route, /save_workspace_integration_credentials/);
  assert.match(route, /save_workspace_database_credentials/);
});

test("worker only loads credentials from a connected and freshly tested integration", () => {
  assert.match(worker, /integration\.status !== "connected"/);
  assert.match(worker, /integration\.last_test_status !== "passed"/);
  assert.match(worker, /WORKSPACE_CREDENTIALS_NOT_CONFIGURED/);
});
