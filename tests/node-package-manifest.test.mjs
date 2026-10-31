import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = readFileSync(new URL("../lib/nodes/package-manifest.ts", import.meta.url), "utf8");
const architecture = readFileSync(new URL("../docs/nodes/community-node-installation.md", import.meta.url), "utf8");

test("community node manifest pins identity, version and artifact integrity", () => {
  assert.match(manifest, /packageName: z\.string\(\)\.regex/);
  assert.match(manifest, /packageVersion: z\.string\(\)\.regex/);
  assert.match(manifest, /integrity: z\.string\(\)\.regex\(\/\^sha512-/);
  assert.match(manifest, /runtimeApiVersion: z\.literal\(1\)/);
});

test("community node permissions are narrow capabilities, not raw credentials", () => {
  assert.match(manifest, /"connector\.invoke"/);
  assert.doesNotMatch(manifest, /"credentials\.read"/);
  assert.match(manifest, /nativeDependencies: z\.literal\(false\)/);
  assert.match(manifest, /installPolicy: z\.literal\("no-scripts"\)/);
});

test("untrusted package execution is explicitly isolated from the app server", () => {
  assert.match(architecture, /will not install or execute arbitrary npm packages inside the Next\.js application/);
  assert.match(architecture, /Never `require\(\)` or dynamically import untrusted package code/);
  assert.match(architecture, /Phase 1 — Contract and policy/);
});
