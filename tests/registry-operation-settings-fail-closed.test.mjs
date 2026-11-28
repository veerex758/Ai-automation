import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/registry-operation-settings.tsx", import.meta.url), "utf8");

test("registry settings never silently substitutes a missing saved app or operation", () => {
  assert.match(source, /available\.find\(\(node\) => node\.id === nodeId\)/);
  assert.match(source, /operations\.find\(\(item\) => item\.id === operationId\)/);
  assert.doesNotMatch(source, /catalog\.find\(\(node\) => node\.id === nodeId\) \?\? available\[0\]/);
  assert.doesNotMatch(source, /operations\.find\(\(item\) => item\.id === operationId\) \?\? operations\[0\]/);
  assert.match(source, /Saved app \/ node is unavailable/);
  assert.match(source, /Saved operation is unavailable/);
  assert.match(source, /role="alert"/);
});
