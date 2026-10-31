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
  approvedPermissions: readonly string[];
}

export function canManageWorkspaceNodes(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canActivateNodeForWorkspace(
  review: NodeSecurityReview,
  grant: WorkspaceNodeGrant | null | undefined,
  requestedPermissions: readonly string[],
  currentActorWorkspaceRole: WorkspaceRole | null | undefined,
): boolean {
  // The caller must derive this role from the authenticated workspace membership,
  // never from request input. This helper does not replace the database RLS check.
  if (!canManageWorkspaceNodes(currentActorWorkspaceRole)) return false;
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

  if (!grant || grant.state !== "active") {
    return false;
  }

  const approved = new Set(grant.approvedPermissions);
  return requestedPermissions.every((permission) => approved.has(permission));
}
