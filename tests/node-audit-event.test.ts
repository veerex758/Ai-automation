import test from "node:test";
import assert from "node:assert/strict";
import { createNodeAuditEvent } from "../lib/nodes/audit-event";

test("creates a workspace-scoped permission audit event with narrow metadata", () => {
  const event = createNodeAuditEvent({
    workspaceId: "workspace-123",
    actorUserId: "user-456",
    eventType: "node.permission_granted",
    packageName: "@aivanta/crm",
    packageVersion: "1.2.3",
    installationId: "install-789",
    permission: "connector.invoke",
  });
  assert.equal(event.resource_type, "workspace_node_installation");
  assert.equal(event.resource_id, "install-789");
  assert.deepEqual(event.metadata, {
    package_name: "@aivanta/crm",
    package_version: "1.2.3",
    installation_id: "install-789",
    permission: "connector.invoke",
  });
  assert.equal("token" in event.metadata, false);
});

test("requires installation identity for workspace lifecycle events", () => {
  assert.throws(() => createNodeAuditEvent({
    workspaceId: "workspace-123",
    actorUserId: "user-456",
    eventType: "node.installation_disabled",
    packageName: "@aivanta/crm",
    packageVersion: "1.2.3",
  }), /installation id/);
});

test("rejects suspicious identifiers and malformed artifact integrity", () => {
  const base = {
    workspaceId: "workspace-123",
    actorUserId: "user-456",
    eventType: "node.version_approved" as const,
    packageName: "@aivanta/crm",
    packageVersion: "1.2.3",
  };
  assert.throws(() => createNodeAuditEvent({ ...base, workspaceId: "workspace-123\nsecret" }));
  assert.throws(() => createNodeAuditEvent({ ...base, artifactIntegrity: "sha1-not-safe" }));
});
