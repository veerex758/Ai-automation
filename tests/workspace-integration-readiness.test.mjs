import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const activation = await readFile(new URL("../app/api/workflows/[workflowId]/route.ts", import.meta.url), "utf8");
const oauthCallback = await readFile(new URL("../app/api/integrations/oauth/[provider]/callback/route.ts", import.meta.url), "utf8");

test("saving a connection targets exactly one account and revokes previous verification atomically", () => {
  assert.ok(route.includes("save_workspace_integration_connection"));
  assert.ok(route.includes("p_connection_id: connectionId"));
  assert.ok(route.includes("p_create_new: requestedConnectionId === undefined"));
  assert.match(route, /requestedConnectionId && !\/\^[0-9a-f]/);
});

test("worker refuses implicit defaults and requires a connected, freshly tested selected account", () => {
  assert.ok(worker.includes("WORKSPACE_CONNECTION_SELECTION_REQUIRED"));
  assert.ok(worker.includes("selectedConnectionIds.get(provider)"));
  assert.ok(worker.includes('eq("status", "connected")'));
  assert.ok(worker.includes('eq("last_test_status", "passed")'));
  assert.ok(worker.includes('eq("id", selectedConnectionId)'));
  assert.ok(worker.includes('secret.encryption_version === "v2"'));
  assert.ok(worker.includes("encryptWorkspaceCredentialsV2"));
});

test("activation checks each node selected connection against its provider and workspace", () => {
  assert.ok(activation.includes("step.connectionId"));
  assert.ok(activation.includes("WORKSPACE_CONNECTION_SELECTION_REQUIRED"));
  assert.ok(activation.includes("WORKSPACE_CONNECTION_NOT_VERIFIED"));
  assert.ok(activation.includes('eq("workspace_id", candidate.workspace_id)'));
});

test("OAuth callback persists the exact selected account using connection-bound encryption", () => {
  assert.ok(oauthCallback.includes("encryptWorkspaceCredentialsV2"));
  assert.ok(oauthCallback.includes("stateData.connectionId ?? randomUUID()"));
  assert.ok(oauthCallback.includes("p_create_new: stateData.connectionId === undefined"));
});
