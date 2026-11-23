import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Vercel keeps the existing daily scheduler and registers the private 15-minute production worker", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.crons, undefined);
  assert.deepEqual(config.schedules["internal-scheduler-daily"], {
    schedule: "0 9 * * *",
    path: "/api/internal/scheduler",
    requestMethod: "GET",
  });
  assert.deepEqual(config.schedules["billing-reconcile"], {
    schedule: "0 10 * * *",
    path: "/api/internal/billing/reconcile",
    requestMethod: "POST",
  });
  assert.deepEqual(config.schedules["operations-alerts"], {
    schedule: "0 11 * * *",
    path: "/api/internal/operations/alerts",
    requestMethod: "POST",
  });
  assert.deepEqual(config.schedules["paystack-recurring-renewals"], {
    schedule: "30 12 * * *",
    path: "/api/internal/billing/paystack-renewals",
    requestMethod: "POST",
  });
  assert.deepEqual(config.schedules["real-estate-automation"], {
    schedule: "*/15 * * * *",
    function: "api/real-estate-automation",
    timezone: "Africa/Lagos",
  });
  assert.deepEqual(config.functions["api/real-estate-automation.ts"].experimentalTriggers, [
    { type: "schedule/v1beta" },
  ]);
});

test("private scheduled worker runs only in Production and gates pipeline and follow-ups", async () => {
  const worker = await readFile(new URL("../api/real-estate-automation.ts", import.meta.url), "utf8");
  assert.match(worker, /handleSchedule/);
  assert.match(worker, /VERCEL_ENV !== "production"/);
  assert.match(worker, /AIVANTA_LIVE_EXECUTION_ENABLED/);
  assert.match(worker, /REAL_ESTATE_PIPELINE_ENABLED/);
  assert.match(worker, /REAL_ESTATE_FOLLOWUPS_ENABLED/);
  assert.match(worker, /processRealEstateLeadPipeline/);
  assert.match(worker, /processDueRealEstateFollowups/);
});

test("legacy protected endpoint remains fail-closed for manual fallback invocations", async () => {
  const route = await readFile(new URL("../app/api/cron/real-estate-automation/route.ts", import.meta.url), "utf8");
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /processRealEstateLeadPipeline/);
  assert.match(route, /processDueRealEstateFollowups/);
  assert.match(route, /CRON_SECRET/);
});

test("internal scheduler endpoint keeps a server-only bearer secret and does not run provider actions directly", async () => {
  const route = await readFile(new URL("../app/api/internal/scheduler/route.ts", import.meta.url), "utf8");
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /dispatch_workflow_execution/);
  assert.doesNotMatch(route, /sendResendEmail|sendSlackMessage|provider\.execute/);
});
