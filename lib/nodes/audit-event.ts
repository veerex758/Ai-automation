export const NODE_AUDIT_EVENT_TYPES = [
  "node.installation_created",
  "node.permission_granted",
  "node.permission_revoked",
  "node.installation_disabled",
  "node.installation_uninstalled",
] as const;

export type NodeAuditEventType = (typeof NODE_AUDIT_EVENT_TYPES)[number];

export interface NodeAuditEventInput {
  workspaceId: string;
  actorUserId: string;
  eventType: NodeAuditEventType;
  packageName: string;
  packageVersion: string;
  installationId?: string;
  permission?: string;
  artifactIntegrity?: string;
  reasonCode?: string;
}

export interface NodeAuditEventRecord {
  workspace_id: string;
  actor_user_id: string;
  event_type: NodeAuditEventType;
  resource_type: "node_package_version" | "workspace_node_installation";
  resource_id: string;
  metadata: {
    package_name: string;
    package_version: string;
    installation_id?: string;
    permission?: string;
    artifact_integrity?: string;
    reason_code?: string;
  };
}

const SAFE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,254}$/;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;

function requireSafeIdentifier(value: string, label: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

/**
 * Build a deliberately narrow audit record. Callers cannot pass arbitrary
 * metadata, which prevents credentials, tokens or raw package data entering
 * the audit trail by accident.
 */
export function createNodeAuditEvent(input: NodeAuditEventInput): NodeAuditEventRecord {
  const workspaceId = requireSafeIdentifier(input.workspaceId, "workspace id");
  const actorUserId = requireSafeIdentifier(input.actorUserId, "actor id");
  const packageName = requireSafeIdentifier(input.packageName, "package name");
  const packageVersion = requireSafeIdentifier(input.packageVersion, "package version");

  const installationId = input.installationId
    ? requireSafeIdentifier(input.installationId, "installation id")
    : undefined;
  const permission = input.permission
    ? requireSafeIdentifier(input.permission, "permission")
    : undefined;
  const reasonCode = input.reasonCode
    ? requireSafeIdentifier(input.reasonCode, "reason code")
    : undefined;

  if (input.artifactIntegrity && !SHA512_INTEGRITY.test(input.artifactIntegrity)) {
    throw new Error("Invalid artifact integrity.");
  }

  if (!installationId) {
    throw new Error("Workspace lifecycle events require an installation id.");
  }

  return {
    workspace_id: workspaceId,
    actor_user_id: actorUserId,
    event_type: input.eventType,
    resource_type: "workspace_node_installation",
    resource_id: installationId,
    metadata: {
      package_name: packageName,
      package_version: packageVersion,
      ...(installationId ? { installation_id: installationId } : {}),
      ...(permission ? { permission } : {}),
      ...(input.artifactIntegrity ? { artifact_integrity: input.artifactIntegrity } : {}),
      ...(reasonCode ? { reason_code: reasonCode } : {}),
    },
  };
}
