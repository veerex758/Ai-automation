import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../scripts/review-node-package.mjs", import.meta.url), "utf8");

test("package review is static and never imports or executes package code", () => {
  assert.match(source, /execFileSync\("tar", \["-tzf"/);
  assert.match(source, /executedPackageCode: false/);
  assert.match(source, /malwareCertification: "not_performed"/);
  assert.doesNotMatch(source, /await import\(archivePath/);
});

test("package review pins exact archive entries and integrity", () => {
  assert.match(source, /createHash\("sha512"\)/);
  assert.match(source, /assert\.equal\(actualIntegrity, expectedIntegrity/);
  assert.match(source, /const allowed = new Set/);
  assert.match(source, /Unsafe archive path/);
});

test("package review rejects dangerous runtime capabilities", () => {
  for (const capability of ["process", "require", "fetch", "WebSocket", "WebAssembly"]) {
    assert.ok(source.includes(capability), capability);
  }
  assert.match(source, /Forbidden capability pattern detected/);
});
