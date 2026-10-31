import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workspace/integrations/route.ts", import.meta.url), "utf8");
const workflowRoute = readFileSync(new URL("../app/api/workflows/[workflowId]/integrations/route.ts", import.meta.url), "utf8");

test("workspace connection manager works without requiring a workflow", () => {
  assert.match(route, /getOrCreateDefaultWorkspace\(userClient\)/);
  assert.doesNotMatch(route, /workflowId|context\.params/);
  assert.match(route, /Cache-Control.*private, no-store/);
});

test("only workspace owners and admins can save, test, or disconnect credentials", () => {
  assert.match(route, /workspace_members/);
  assert.match(route, /\["owner", "admin"\]/);
  assert.match(route, /await requireWorkspaceManager\(auth\)/);
  assert.match(workflowRoute, /await requireWorkflowManager\(auth\)/);
});

test("credential save rolls back metadata if encrypted secret persistence fails", () => {
  assert.match(route, /workspace_integration_secrets/);
  assert.match(route, /if \(secretError\)/);
  assert.match(route, /rollbackError/);
  assert.match(route, /status: "needs_attention"/);
  assert.match(route, /saved: true/);
  assert.doesNotMatch(route, /secretReturned: true/);
});

test("Slack verification sends a real test only after explicit user confirmation", () => {
  assert.match(route, /SLACK_TEST_REQUIRES_EXPLICIT_DELIVERY/);
  assert.match(route, /allowSlackDeliveryTest/);
  assert.match(route, /method: "POST"/);
  assert.match(route, /Aivanta connection test/);
});

test("HTTP connection verification accepts only a successful 2xx response", () => {
  assert.match(route, /result\.status < 200 \|\| result\.status >= 300/);
  assert.match(workflowRoute, /result\.status < 200 \|\| result\.status >= 300/);
});

