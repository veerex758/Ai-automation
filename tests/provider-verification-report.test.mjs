import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const report = await readFile(new URL("../docs/integrations/provider-verification-report.md", import.meta.url), "utf8");

test("provider verification report publishes all registry mappings and clearly blocks unverified live execution", () => {
  assert.ok(report.includes("- Catalogue entries: 100"));
  assert.ok(report.includes("- All native registry operations: 146"));
  assert.ok(report.includes("- Worker operation mappings: 146"));
  assert.ok(report.includes("- Missing mappings: 0"));
  assert.ok(report.includes("Authenticated staging/live verification: BLOCKED"));
  assert.ok(report.includes("No provider is labelled live-verified"));
  assert.ok(report.includes("MySQL (mysql)"));
  assert.ok(report.includes("MongoDB (mongodb)"));
});
