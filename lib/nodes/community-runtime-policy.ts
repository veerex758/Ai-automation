/** Fail-closed authorization policy for community node execution. */
export type CommunityRuntimeAuthorization = {
  installationStatus: string;
  packageStatus: string;
  publisherStatus: string;
  reviewStatus: string;
  artifactIntegrityVerified: boolean;
  dependencyScanPassed: boolean;
  malwareScanPassed: boolean;
  permissionReviewApproved: boolean;
  workerAvailable: boolean;
  grantedPermissions: readonly string[];
  declaredPermissions: readonly string[];
  requestedPermissions: readonly string[];
};

export function canExecuteCommunityNode(input: CommunityRuntimeAuthorization): boolean {
  if (input.installationStatus !== "active" || input.packageStatus !== "active" ||
      input.publisherStatus !== "verified" || input.reviewStatus !== "approved") return false;
  if (!input.artifactIntegrityVerified || !input.dependencyScanPassed ||
      !input.malwareScanPassed || !input.permissionReviewApproved || !input.workerAvailable) return false;
  const declared = new Set(input.declaredPermissions);
  const granted = new Set(input.grantedPermissions);
  return input.requestedPermissions.every((permission =>
    declared.has(permission) && granted.has(permission)
  ));
}

/** Community node availability in the builder is strictly narrower than catalogue visibility. */
export function isCommunityNodeBuilderEligible(input: CommunityRuntimeAuthorization): boolean {
  return canExecuteCommunityNode(input);
}
