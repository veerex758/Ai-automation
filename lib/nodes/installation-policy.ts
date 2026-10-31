export const NODE_INSTALLATION_STATES = [
  "pending_review",
  "approved",
  "rejected",
  "quarantined",
] as const;

export type NodeInstallationState = (typeof NODE_INSTALLATION_STATES)[number];
export type WorkspaceRole = "owner" | "admin" | "member";
export type WorkspaceGrantState = "active" | "revoked";

export interface NodeSecurityReview {
  publisherVerified: boolean;
  registryReviewApproved: boolean;
  artifactIntegrityVerified: boolean;
  dependencyScanPassed: boolean;
  malwareScanPassed: boolean;
  permissionReviewApproved: boolean;
  isolatedWorkerAvailable: boolean;
  state: NodeInstallationState;
}

export interface WorkspaceNodeGrant {
  state: WorkspaceGrantState;
  approvedByRole: WorkspaceRole;
  approvedPermissions: readonly string[];
}

export function canManageWorkspaceNodes(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canActivateNodeForWorkspace(
  review: NodeSecurityReview,
  grant: WorkspaceNodeGrant | null | undefined,
  requestedPermissions: readonly string[],
): boolean {
  if (review.state !== "approved") return false;
  if (
    !review.publisherVerified ||
    !review.registryReviewApproved ||
    !review.artifactIntegrityVerified ||
    !review.dependencyScanPassed ||
    !review.malwareScanPassed ||
    !review.permissionReviewApproved ||
    !review.isolatedWorkerAvailable
  ) return false;

  if (!grant || grant.state !== "active" || !canManageWorkspaceNodes(grant.approvedByRole)) {
    return false;
  }

  const approved = new Set(grant.approvedPermissions);
  return requestedPermissions.every((permission) => approved.has(permission));
}
