import test from "node:test";
import assert from "node:assert/strict";
import registryModule from "../lib/workflows/node-registry.cjs";

const { getNodeRegistry, findNode } = registryModule;

test("registry exposes webhook trigger metadata without claiming live execution", () => {
  const registry = getNodeRegistry();
  const webhook = registry.triggers.find((node) => node.id === "trigger.webhook");
  assert.ok(webhook);
  assert.equal(webhook.auth, "signed_secret");
  assert.equal(webhook.execution, "registry_only");
  assert.ok(webhook.requirements.includes("signed_request_validation"));
  assert.ok(webhook.requirements.includes("durable_queue"));
  assert.equal(registry.policy.defaultMode, "dry_run");
  assert.equal(registry.policy.liveExecutionEnabledByDefault, false);
});

test("registry reuses the existing action catalog for consistent UI and runner metadata", () => {
  const registry = getNodeRegistry();
  assert.ok(registry.actions.some((node) => node.id === "email.send_email"));
  assert.ok(registry.actions.some((node) => node.id === "webhook.http_request"));
  assert.equal(registry.actions.find((node) => node.id === "webhook.http_request").execution, "dry_run_only");
  assert.equal(findNode("trigger.webhook").operation, "receive_event");
});

test("callers cannot mutate the shared registry through returned metadata", () => {
  const first = getNodeRegistry();
  first.triggers[0].label = "corrupted";
  first.actions[0].fields[0]?.label && (first.actions[0].fields[0].label = "corrupted");
  const second = getNodeRegistry();
  assert.equal(second.triggers[0].label, "Run manually");
  assert.notEqual(second.actions[0].fields[0]?.label, "corrupted");
});
