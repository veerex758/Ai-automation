import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const access = readFileSync(new URL("../lib/nodes/platform-review-access.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/platform/nodes/review/route.ts", import.meta.url), "utf8");
const reviewMigration = readFileSync(
  new URL("../supabase/migrations/20261103010000_aivanta_platform_node_review_rpc.sql", import.meta.url),
  "utf8",
);

test("platform review access is separate from workspace membership and fails closed", () => {
  assert.match(access, /AIVANTA_PLATFORM_ADMIN_USER_IDS/);
  assert.match(access, /configuredIds\\.length === 0/);
  assert.match(access, /!configuredIds\\.includes\\(user\\.id\\)/);
  assert.doesNotMatch(access, /workspace_members|workspace_admin/);
});

test("package approval requires every independent review gate", () => {
  for (const gate of [
    "verified_publisher",
    "publisher_provenance",
    "dependency_scan",
    "malware_scan",
    "permission_review",
  ]) assert.ok(reviewMigration.includes(gate), gate);
  assert.match(reviewMigration, /review_status = 'approved'/);
});

test("platform reviewer cannot self-assert scan or provenance results through request body", () => {
  assert.doesNotMatch(route, /input\\.(dependencyScanStatus|malwareScanStatus|publisherProvenanceVerified|permissionsReviewedAt)/);
  assert.match(route, /evidenceReference/);
  assert.match(route, /rpc\\("review_node_registry_resource"/);
  assert.match(reviewMigration, /node_platform_audit_events/);
});
