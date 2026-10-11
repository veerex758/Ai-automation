import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../lib/workflows/action-catalog.cjs";

const { getActionCatalog, findAction } = catalog;

test("exposes a stable catalog of supported provider-operation pairs", () => {
  const actions = getActionCatalog();
  assert.deepEqual(actions.map(({ provider, operation }) => [provider, operation]), [
    ["internal", "create_task"],
    ["email", "send_email"],
    ["slack", "send_message"],
    ["webhook", "http_request"],
  ]);
  assert.equal(new Set(actions.map((action) => action.id)).size, actions.length);
});

test("documents live email guardrails and keeps other connectors dry-run only", () => {
  const actions = getActionCatalog();
  assert.equal(findAction("email", "send_email").execution, "live_guarded");
  assert.deepEqual(findAction("email", "send_email").requirements, [
    "server_credentials", "verified_sender", "recipient_allowlist", "explicit_live_execution_flag",
  ]);
  assert.ok(actions.filter((action) => action.provider !== "email").every((action) => action.execution === "dry_run_only"));
});

test("describes fields without including credentials or secret values", () => {
  const serialized = JSON.stringify(getActionCatalog()).toLowerCase();
  assert.doesNotMatch(serialized, /api[_-]?key|access[_-]?token|client[_-]?secret|password/);
  assert.ok(getActionCatalog().every((action) => action.fields.every((field) =>
    typeof field.name === "string" && typeof field.label === "string" &&
    typeof field.required === "boolean" && Number.isInteger(field.maxLength)
  )));
});

test("returns defensive copies so callers cannot mutate the shared catalog", () => {
  const first = getActionCatalog();
  first[0].fields[0].label = "Injected label";
  first[0].requirements?.push("injected");
  const second = getActionCatalog();
  assert.notEqual(second[0].fields[0].label, "Injected label");
  assert.equal(findAction("not-real", "run"), null);
});
