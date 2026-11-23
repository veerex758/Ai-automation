import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");

test("saving or replacing workspace credentials revokes prior successful connection readiness", () => {
  assert.match(route, /save_workspace_integration_connection/);
  assert.match(route, /p_connection_id: connectionId \?\? null/);
  assert.match(route, /Only workspace owners and admins can manage integrations/);
});

test("worker only loads credentials from a connected and freshly tested integration", () => {
  assert.match(worker, /\.eq\("status", "connected"\)/);
  assert.match(worker, /\.eq\("last_test_status", "passed"\)/);
  assert.match(worker, /WORKSPACE_CREDENTIALS_NOT_CONFIGURED/);
  assert.match(worker, /WORKSPACE_CONNECTION_SELECTION_REQUIRED/);
});
