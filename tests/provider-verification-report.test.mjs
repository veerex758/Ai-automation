import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const report = await readFile(new URL("../docs/integrations/provider-verification-report.md", import.meta.url), "utf8");

test("provider verification report publishes current inventory and blocks unverified live claims", () => {
  assert.ok(report.includes("Native executable registry: **122**"));
  assert.ok(report.includes("Provider directory: **100**"));
  assert.ok(report.includes("Provider entries with registered implementations: **100**"));
  assert.ok(report.includes("Coming-soon provider entries: **0**"));
  assert.ok(report.includes("Worker-operation parity"));
  assert.ok(report.includes("Authenticated staging workflow acceptance"));
  assert.ok(report.includes("No provider is labelled production-live-verified"));
  assert.ok(report.includes("MySQL and MongoDB"));
});
