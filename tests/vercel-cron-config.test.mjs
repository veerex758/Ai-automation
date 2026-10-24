import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), "utf8");

test("Vercel cron targets the protected scheduler endpoint at the intended cadence", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.deepEqual(config.crons, [
    { path: "/api/internal/scheduler", schedule: "*/5 * * * *" },
  ]);
});

test("scheduler verification guide preserves dry-run and deployment safety boundaries", () => {
  const guide = read("docs/scheduler-staging-verification.md");
  assert.match(guide, /dry-run engine only/i);
  assert.match(guide, /do not deploy this change to production solely to test cron/i);
  assert.match(guide, /Authorization: Bearer/i);
  assert.match(guide, /Never record tokens, authorization headers/i);
  assert.match(guide, /## Rollback/);
});

test("example environment documents scheduler credentials as server-only placeholders", () => {
  const example = read(".env.example");
  assert.match(example, /^CRON_SECRET=your_random_cron_secret_here$/m);
  assert.match(example, /^SUPABASE_SECRET_KEY=your_supabase_secret_key_here$/m);
  assert.doesNotMatch(example, /SUPABASE_SECRET_KEY=eyJ[A-Za-z0-9_-]+/);
});
