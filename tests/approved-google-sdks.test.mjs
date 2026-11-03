import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Google integration SDKs are official packages pinned to exact versions", () => {
  assert.equal(pkg.dependencies["@googleapis/gmail"], "22.0.2");
  assert.equal(pkg.dependencies["@googleapis/sheets"], "18.1.2");
  assert.ok(!pkg.dependencies["@googleapis/gmail"].startsWith("^"));
  assert.ok(!pkg.dependencies["@googleapis/sheets"].startsWith("^"));
  assert.equal(pkg.dependencies["@slack/web-api"], "8.2.0");
  assert.ok(!pkg.dependencies["@slack/web-api"].startsWith("^"));
});

test("Aivanta does not add n8n runtime packages as executable dependencies", () => {
  assert.equal(Object.keys(pkg.dependencies).some((name) => name === "n8n" || name.startsWith("n8n-nodes-")), false);
});
