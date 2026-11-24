import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Vercel Schedules dispatch workflows and recover abandoned workers within Hobby limits", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.schedules["workflow-scheduler-tick"], {
    schedule: "*/30 * * * *", path: "/api/internal/scheduler", requestMethod: "POST", timezone: "UTC",
  });
  assert.deepEqual(config.schedules["durable-worker-recovery"], {
    schedule: "0 * * * *", path: "/api/internal/worker", requestMethod: "POST", timezone: "UTC",
  });
  assert.equal(config.crons, undefined);
});

test("scheduler endpoint requires a server-only bearer secret and never runs provider actions directly", async () => {
  const route = await readFile(new URL("../app/api/internal/scheduler/route.ts", import.meta.url), "utf8");
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /dispatch_workflow_execution/);
  assert.doesNotMatch(route, /sendResendEmail|sendSlackMessage|provider\.execute/);
});
