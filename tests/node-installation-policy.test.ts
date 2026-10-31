import test from "node:test";
import assert from "node:assert/strict";
import {
  canActivateNodeForWorkspace,
  canManageWorkspaceNodes,
} from "../lib/nodes/installation-policy";

const readyReview = {
  publisherVerified: true,
  registryReviewApproved: true,
  artifactIntegrityVerified: true,
  dependencyScanPassed: true,
  malwareScanPassed: true,
  permissionReviewApproved: true,
  isolatedWorkerAvailable: true,
  state: "approved" as const,
};

test("only workspace owners and admins can manage node installations", () => {
  assert.equal(canManageWorkspaceNodes("owner"), true);
  assert.equal(canManageWorkspaceNodes("admin"), true);
  assert.equal(canManageWorkspaceNodes("member"), false);
  assert.equal(canManageWorkspaceNodes(null), false);
});

test("activation requires every platform security gate and an active admin grant", () => {
  const grant = {
    state: "active" as const,
    approvedPermissions: ["connector.invoke", "logger.write"],
  };
  assert.equal(
    canActivateNodeForWorkspace(readyReview, grant, ["connector.invoke"], "admin"),
    true,
  );
  assert.equal(
    canActivateNodeForWorkspace(readyReview, grant, ["connector.invoke", "http.outbound"], "admin"),
    false,
  );
  assert.equal(
    canActivateNodeForWorkspace(readyReview, { ...grant, state: "revoked" }, ["connector.invoke"], "owner"),
    false,
  );
});

test("pending, rejected and quarantined packages can never activate", () => {
  const grant = {
    state: "active" as const,
    approvedPermissions: ["connector.invoke"],
  };
  for (const state of ["pending_review", "rejected", "quarantined"] as const) {
    assert.equal(
      canActivateNodeForWorkspace({ ...readyReview, state }, grant, ["connector.invoke"], "owner"),
      false,
    );
  }
});

test("any missing publisher, artifact, scan, permission or worker gate blocks activation", () => {
  const grant = {
    state: "active" as const,
    approvedByRole: "owner" as const,
    approvedPermissions: ["connector.invoke"],
  };
  const gates = [
    "publisherVerified",
    "registryReviewApproved",
    "artifactIntegrityVerified",
    "dependencyScanPassed",
    "malwareScanPassed",
    "permissionReviewApproved",
    "isolatedWorkerAvailable",
  ] as const;
  for (const gate of gates) {
    assert.equal(
      canActivateNodeForWorkspace({ ...readyReview, [gate]: false }, grant, ["connector.invoke"], "owner"),
      false,
      gate,
    );
  }
});

test("a member cannot activate a package even when a matching grant exists", () => {
  const grant = {
    state: "active" as const,
    approvedPermissions: ["connector.invoke"],
  };
  assert.equal(
    canActivateNodeForWorkspace(readyReview, grant, ["connector.invoke"], "member"),
    false,
  );
});
