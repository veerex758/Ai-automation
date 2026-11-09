import assert from "node:assert/strict";
import { test } from "node:test";
import { canExecuteCommunityNode, isCommunityNodeBuilderEligible, type CommunityRuntimeAuthorization } from "../lib/nodes/community-runtime-policy";

const eligible: CommunityRuntimeAuthorization = {
  installationStatus: "active", packageStatus: "active", publisherStatus: "verified", reviewStatus: "approved",
  artifactIntegrityVerified: true, dependencyScanPassed: true, malwareScanPassed: true,
  permissionReviewApproved: true, workerAvailable: true,
  grantedPermissions: ["logger.write", "connector.invoke"], declaredPermissions: ["logger.write", "connector.invoke"],
  requestedPermissions: ["connector.invoke"],
};

test("community execution requires every trust and workspace-consent gate", () => {
  assert.equal(canExecuteCommunityNode(eligible), true);
  for (const key of ["installationStatus", "packageStatus", "publisherStatus", "reviewStatus"] as const) {
    assert.equal(canExecuteCommunityNode({...eligible, [key]: "disabled"}), false, key);
  }
  for (const key of ["artifactIntegrityVerified", "dependencyScanPassed", "malwareScanPassed", "permissionReviewApproved", "workerAvailable"] as const) {
    assert.equal(canExecuteCommunityNode({...eligible, [key]: false}), false, key);
  }
});

test("a requested permission must be declared and actively granted", () => {
  assert.equal(canExecuteCommunityNode({...eligible, requestedPermissions: ["http.outbound"]}), false);
  assert.equal(canExecuteCommunityNode({...eligible, grantedPermissions: ["logger.write"]}), false);
  assert.equal(canExecuteCommunityNode({...eligible, requestedPermissions: []}), true);
});

test("builder eligibility uses the same fail-closed gate as execution", () => {
  assert.equal(isCommunityNodeBuilderEligible(eligible), true);
  assert.equal(isCommunityNodeBuilderEligible({...eligible, installationStatus: "disabled"}), false);
});
