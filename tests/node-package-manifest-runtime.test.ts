import test from "node:test";
import assert from "node:assert/strict";
import {
  nodePackageManifestSchema,
  validateNodePackageManifest,
} from "../lib/nodes/package-manifest";

const validManifest = {
  schemaVersion: 1,
  packageName: "@aivanta/community-example",
  packageVersion: "1.2.3",
  displayName: "Example community node",
  description: "A reviewed example node package for manifest validation tests.",
  publisher: {
    name: "Aivanta Test Publisher",
    url: "https://example.com/publishers/aivanta-test",
  },
  runtimeApiVersion: 1,
  entrypoint: "dist/index.js",
  integrity: `sha512-${"A".repeat(86)}==`,
  permissions: ["connector.invoke", "logger.write"],
  installPolicy: "no-scripts",
  nativeDependencies: false,
};

test("accepts a fully pinned and permission-scoped package manifest", () => {
  assert.deepEqual(validateNodePackageManifest(validManifest), validManifest);
});

test("rejects unscoped packages, mutable versions and unsafe entrypoints", () => {
  for (const patch of [
    { packageName: "community-example" },
    { packageVersion: "latest" },
    { packageVersion: "1.2" },
    { entrypoint: "dist/../secrets.js" },
    { entrypoint: "/tmp/package.js" },
  ]) {
    assert.equal(nodePackageManifestSchema.safeParse({ ...validManifest, ...patch }).success, false);
  }
});

test("rejects unknown or duplicated capabilities and install-time execution", () => {
  for (const patch of [
    { permissions: ["connector.invoke", "connector.invoke"] },
    { permissions: ["credentials.read"] },
    { installPolicy: "run-scripts" },
    { nativeDependencies: true },
  ]) {
    assert.equal(nodePackageManifestSchema.safeParse({ ...validManifest, ...patch }).success, false);
  }
});

test("rejects extra fields so undeclared manifest capabilities cannot slip through", () => {
  assert.equal(
    nodePackageManifestSchema.safeParse({ ...validManifest, environmentAccess: true }).success,
    false,
  );
});
