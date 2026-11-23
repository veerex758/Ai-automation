import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20261122110000_real_estate_notification_recipients.sql");
const route = read("../app/api/real-estate/notification-recipients/route.ts");
const updateRoute = read("../app/api/real-estate/notification-recipients/[recipientId]/route.ts");
const pipeline = read("../lib/real-estate/pipeline.ts");

test("agency alert recipients require a workspace admin approval and retain revocation audit", () => {
  assert.match(migration, /private\.is_workspace_admin\(workspace_id\)/);
  assert.match(migration, /approved_by uuid not null/);
  assert.match(migration, /approved_at timestamptz not null/);
  assert.match(migration, /revoked_by uuid/);
  assert.match(migration, /revoked_at timestamptz/);
  assert.match(migration, /enforce_real_estate_notification_recipient_audit/);
  assert.match(migration, /grant insert \(workspace_id, email, active\)/i);
  assert.match(migration, /grant update \(active\)/i);
  assert.match(migration, /alter table public\.real_estate_notification_recipients enable row level security/i);
});

test("recipient APIs enforce owner/admin permissions and normalize email addresses", () => {
  assert.match(route, /\["owner", "admin"\]/);
  assert.match(route, /toLowerCase\(\)/);
  assert.match(route, /active: true/);
  assert.match(updateRoute, /\["owner", "admin"\]/);
  assert.match(updateRoute, /const update = \{ active \}/);
});

test("pipeline never falls back to workspace profile emails", () => {
  assert.match(pipeline, /real_estate_notification_recipients/);
  assert.doesNotMatch(pipeline, /auth\.admin\.getUserById/);
  assert.match(pipeline, /AGENCY_NOTIFICATION_RECIPIENT_NOT_APPROVED/);
});
