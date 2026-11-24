import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("distributed limiter uses trusted edge identity and fails closed", async () => {
  const helper = await read("../lib/security/distributed-rate-limit.ts");
  assert.ok(helper.includes('request.headers.get("x-real-ip")'));
  assert.ok(!helper.includes('headers.get("x-forwarded-for")'));
  assert.ok(helper.includes("createAdminClient"));
  assert.ok(helper.includes("consume_api_rate_limit"));
  assert.ok(helper.includes("status: 429"));
  assert.ok(helper.includes("status: 503"));
});

test("database limiter is atomic and does not expose identity keys", async () => {
  const migration = await read("../supabase/migrations/20261124110000_rexnora_security_keyring_and_ingress_rate_limits.sql");
  assert.ok(migration.includes("on conflict (scope, key_hash) do update"));
  assert.ok(migration.includes("key_digest := md5(p_key)"));
  assert.ok(migration.includes("security definer"));
  assert.ok(migration.includes("set search_path = ''"));
  assert.ok(migration.includes("enable row level security"));
  assert.ok(migration.includes("grant execute on function public.consume_api_rate_limit"));
});

test("rotation defaults to dry-run, makes ciphertext-only backup and supports restore", async () => {
  const script = await read("../scripts/rotate-workspace-credentials.ts");
  assert.ok(script.includes("if (!apply) return"));
  assert.ok(script.includes('flag: "wx", mode: 0o600'));
  assert.ok(script.includes("--restore-from"));
  assert.ok(script.includes("current.encrypted_credentials !== entry.rotated_encrypted_credentials"));
  assert.ok(script.includes(".range(offset, offset + 499)") || script.includes(".range(offset, offset + 499)"));
  assert.ok(script.includes('.eq("encrypted_credentials", item.secret.encrypted_credentials)'));
});


test("database limiter increments past the threshold and saturates at limit plus one", async () => {
  const migration = await read("../supabase/migrations/20261124120000_rexnora_api_rate_limit_counter_fix.sql");
  assert.ok(migration.includes("least(current_bucket.hit_count + 1, p_limit + 1)"));
  assert.ok(migration.includes("allowed := bucket.hit_count <= p_limit"));
  assert.ok(migration.includes("check (hit_count between 1 and 10001)"));
});
