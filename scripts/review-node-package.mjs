#!/usr/bin/env node
/**
 * Static review gate for the Aivanta demo package.
 * This inspects archive bytes and source text only; it never imports or runs
 * the untrusted package. A pass is not a malware certification or approval.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const [archivePath, expectedIntegrity] = process.argv.slice(2);
assert.ok(archivePath, "Usage: node scripts/review-node-package.mjs <tarball> <sha512-integrity>");
assert.match(expectedIntegrity ?? "", /^sha512-[A-Za-z0-9+/]+={0,2}$/);

const archive = readFileSync(archivePath);
const actualIntegrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
assert.equal(actualIntegrity, expectedIntegrity, "Archive SHA-512 does not match the pinned manifest");

const entries = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
const allowed = new Set([
  "package/package.json",
  "package/README.md",
  "package/dist/index.js",
]);
assert.deepEqual([...entries].sort(), [...allowed].sort(), "Archive contains unexpected or missing files");
for (const entry of entries) {
  assert.ok(entry.startsWith("package/") && !entry.split("/").includes(".."), `Unsafe archive path: ${entry}`);
}

const readEntry = (entry) => execFileSync("tar", ["-xOzf", archivePath, entry], { encoding: "utf8" });
const pkg = JSON.parse(readEntry("package/package.json"));
assert.equal(pkg.name, "@aivanta/demo-hello");
assert.equal(pkg.version, "1.0.0");
assert.deepEqual(pkg.files, ["dist/index.js", "README.md"]);
assert.equal(pkg.scripts, undefined, "Install/lifecycle scripts are prohibited");
assert.equal(pkg.dependencies, undefined, "Runtime dependencies are prohibited for this demo");
assert.equal(pkg.optionalDependencies, undefined);
assert.equal(pkg.peerDependencies, undefined);

const source = readEntry("package/dist/index.js");
// Ignore comments so documentation of a prohibited API is not a false positive.
const executableSource = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
const forbidden = [
  /\bprocess\b/,
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bfrom\s*["']node:/,
  /\bfrom\s*["'](?:fs|net|http|https|child_process|worker_threads|vm)["']/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
  /\bWebAssembly\b/,
];
for (const pattern of forbidden) {
  assert.equal(pattern.test(executableSource), false, `Forbidden capability pattern detected: ${pattern}`);
}
assert.match(source, /export async function execute/);

const report = {
  package: `${pkg.name}@${pkg.version}`,
  integrity: actualIntegrity,
  archiveEntries: entries,
  staticPolicy: "passed",
  executedPackageCode: false,
  malwareCertification: "not_performed",
  publisherProvenance: "pending_platform_review",
  registryApproval: "pending_platform_review",
  workerExecution: "disabled",
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
