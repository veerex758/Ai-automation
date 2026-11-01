import assert from "node:assert/strict";
import { test } from "node:test";
import { isWorkspaceIntegrationReady } from "../lib/integrations/connection-readiness";
import { isSideEffectingHttpMethod } from "../lib/workflows/execution-side-effects";

test("workspace provider credentials require a successful connection test", () => {
  assert.equal(isWorkspaceIntegrationReady("connected", "passed"), true);
  assert.equal(isWorkspaceIntegrationReady("connected", null), false);
  assert.equal(isWorkspaceIntegrationReady("connected", "failed"), false);
  assert.equal(isWorkspaceIntegrationReady("disconnected", "passed"), false);
  assert.equal(isWorkspaceIntegrationReady("pending", "passed"), false);
});

test("all HTTP mutation methods are classified as external side effects", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isSideEffectingHttpMethod(method), true, method);
  }
  assert.equal(isSideEffectingHttpMethod("GET"), false);
  assert.equal(isSideEffectingHttpMethod(undefined), false);
  assert.equal(isSideEffectingHttpMethod("UNKNOWN"), false);
});
