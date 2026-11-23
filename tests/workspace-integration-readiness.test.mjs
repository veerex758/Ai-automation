import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const activation = await readFile(new URL("../app/api/workflows/[workflowId]/route.ts", import.meta.url), "utf8");

test("saving a connection targets exactly one account and revokes previous verification atomically", () => {
  assert.match(route, /save_workspace_integration_connection/);
  assert.match(route, /p_connection_id: connectionId \?\? null/);
  assert.match(route, /connectionId && !uuidPattern\.test\(connectionId\)/);
});

test("worker refuses implicit defaults and requires a connected, freshly tested selected account", () => {
  assert.match(worker, /WORKSPACE_CONNECTION_SELECTION_REQUIRED/);
  assert.match(worker, /selectedConnectionIds\.get\(provider\)/);
  assert.match(worker, /\.eq\("status", "connected"\)/);
  assert.match(worker, /\.eq\("last_test_status", "passed"\)/);
  assert.match(worker, /\.eq\("id", selectedConnectionId\)/);
});

test("activation checks each node's selected connection against its provider and workspace", () => {
  assert.match(activation, /step\.connectionId/);
  assert.match(activation, /WORKSPACE_CONNECTION_SELECTION_REQUIRED/);
  assert.match(activation, /WORKSPACE_CONNECTION_NOT_VERIFIED/);
  assert.match(activation, /\.eq\("workspace_id", candidate\.workspace_id\)/);
});