import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Vercel cron targets the protected scheduler route at a conservative daily cadence", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.crons, [
    { path: "/api/internal/scheduler", schedule: "0 9 * * *" },
    { path: "/api/internal/billing/reconcile", schedule: "0 10 * * *" },
  ]);
});

test("scheduler endpoint requires a server-only bearer secret and never runs provider actions directly", async () => {
  const route = await readFile(new URL("../app/api/internal/scheduler/route.ts", import.meta.url), "utf8");
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /dispatch_workflow_execution/);
  assert.doesNotMatch(route, /sendResendEmail|sendSlackMessage|provider\.execute/);
});
