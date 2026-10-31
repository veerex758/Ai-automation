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
  resource_type: "workspace_node_installation";
  resource_id: string;
  metadata: {
    package_name: string;
    package_version: string;
    installation_id: string;
    permission?: string;
    artifact_integrity?: string;
    reason_code?: string;
  };
}

const SAFE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,254}$/;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const SCOPED_PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]{0,213}[\/] [a-z0-9][a-z0-9._-]{0,213}$/;
const STABLE_SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function requireSafeIdentifier(value: string, label: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

/** Build a narrow audit record; arbitrary metadata and secret-bearing payloads are impossible. */
export function createNodeAuditEvent(input: NodeAuditEventInput): NodeAuditEventRecord {
  const workspaceId = requireSafeIdentifier(input.workspaceId, "workspace id");
  const actorUserId = requireSafeIdentifier(input.actorUserId, "actor id");

  if (!SCOPED_PACKAGE_NAME.test(input.packageName)) {
    throw new Error("Invalid scoped package name.");
  }
  if (!STABLE_SEMVER.test(input.packageVersion)) {
    throw new Error("Invalid stable package version.");
  }

  const installationId = input.installationId
    ? requireSafeIdentifier(input.installationId, "installation id")
    : undefined;
  if (!installationId) {
    throw new Error("Workspace lifecycle events require an installation id.");
  }

  const permission = input.permission
    ? requireSafeIdentifier(input.permission, "permission")
    : undefined;
  const reasonCode = input.reasonCode
    ? requireSafeIdentifier(input.reasonCode, "reason code")
    : undefined;

  if (input.artifactIntegrity && !SHA512_INTEGRITY.test(input.artifactIntegrity)) {
    throw new Error("Invalid artifact integrity.");
  }

  return {
    workspace_id: workspaceId,
    actor_user_id: actorUserId,
    event_type: input.eventType,
    resource_type: "workspace_node_installation",
    resource_id: installationId,
    metadata: {
      package_name: input.packageName,
      package_version: input.packageVersion,
      installation_id: installationId,
      ...(permission ? { permission } : {}),
      ...(input.artifactIntegrity ? { artifact_integrity: input.artifactIntegrity } : {}),
      ...(reasonCode ? { reason_code: reasonCode } : {}),
    },
  };
}
