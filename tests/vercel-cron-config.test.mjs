import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Vercel Schedules keep the existing scheduler daily and poll real-estate automation every 15 minutes", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.crons, undefined);
  assert.deepEqual(config.schedules["internal-scheduler-daily"], {
    schedule: "0 9 * * *",
    path: "/api/internal/scheduler",
    requestMethod: "GET",
  });
  assert.deepEqual(config.schedules["real-estate-automation"], {
    schedule: "*/15 * * * *",
    path: "/api/cron/real-estate-automation",
    requestMethod: "GET",
    jitter: 15,
  });
});

test("scheduled real-estate automation runs both pipeline and due follow-ups through one worker", async () => {
  const route = await readFile(new URL("../app/api/cron/real-estate-automation/route.ts", import.meta.url), "utf8");
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /processRealEstateLeadPipeline/);
  assert.match(route, /processDueRealEstateFollowups/);
  assert.match(route, /CRON_SECRET/);
});

test("scheduler endpoint requires a server-only bearer secret and never runs provider actions directly", async () => {
  const route = await readFile(new URL("../app/api/internal/scheduler/route.ts", import.meta.url), "utf8");
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /dispatch_workflow_execution/);
  assert.doesNotMatch(route, /sendResendEmail|sendSlackMessage|provider\.execute/);
});
