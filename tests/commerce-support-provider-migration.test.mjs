import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261105070000_aivanta_commerce_support_provider_credentials.sql", import.meta.url), "utf8");

test("commerce and support providers are included in both database credential allowlists", () => {
  for (const provider of ["woocommerce", "paypal", "paddle", "lemon_squeezy", "square", "razorpay", "zoom", "cal_com", "twilio_voice", "docusign"]) {
    const occurrences = migration.match(new RegExp("'" + provider + "'", "g")) ?? [];
    assert.equal(occurrences.length, 2, provider + " must be present in the table constraint and credential RPC");
  }
});

test("commerce and support migration preserves workspace admin and service-role boundaries", () => {
  assert.match(migration, /wm\.role in \('owner','admin'\)/);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_credentials[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_credentials[\s\S]*to service_role/i);
});
