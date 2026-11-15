import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dashboardPath = fileURLToPath(new URL("../app/dashboard/page.tsx", import.meta.url));
const sectionPath = fileURLToPath(new URL("../app/dashboard/section-page.tsx", import.meta.url));
const [dashboard, sections] = await Promise.all([
  readFile(dashboardPath, "utf8"),
  readFile(sectionPath, "utf8"),
]);

test("overview navigation exposes implemented workspace destinations as real links", () => {
  for (const href of [
    "/dashboard",
    "/dashboard#workflows",
    "/dashboard/activity",
    "/dashboard/builder",
    "/dashboard/ai-assistant",
    "/dashboard/agents",
    "/dashboard/templates",
    "/dashboard/connections",
    "/dashboard/analytics",
    "/dashboard/billing",
    "/dashboard/settings",
  ]) {
    assert.ok(dashboard.includes(href), `missing dashboard navigation destination: ${href}`);
  }
  assert.match(dashboard, /<Link key=\{item\.label\} href=\{item\.href\}/);
  assert.doesNotMatch(dashboard, /is part of the upcoming workspace release/);
  assert.match(dashboard, /id="workflows"/);
});

test("section pages retain consistent access to builder and AI assistant", () => {
  assert.match(sections, /\["Workflow builder","\/dashboard\/builder"/);
  assert.match(sections, /\["AI Assistant","\/dashboard\/ai-assistant"/);
  assert.match(sections, /\["Integrations","\/dashboard\/connections"/);
});
