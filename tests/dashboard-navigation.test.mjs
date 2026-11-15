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


const sidebarPath = fileURLToPath(new URL("../app/dashboard/dashboard-sidebar.tsx", import.meta.url));
const agentsPath = fileURLToPath(new URL("../app/dashboard/agents/page.tsx", import.meta.url));
const assistantPath = fileURLToPath(new URL("../app/dashboard/ai-assistant/page.tsx", import.meta.url));
const connectionsPath = fileURLToPath(new URL("../app/dashboard/connections/page.tsx", import.meta.url));
const billingPath = fileURLToPath(new URL("../app/dashboard/billing/page.tsx", import.meta.url));
const layoutPath = fileURLToPath(new URL("../app/dashboard/layout.tsx", import.meta.url));
const [sidebar, agents, assistant, connections, billing, layout] = await Promise.all([
  readFile(sidebarPath, "utf8"), readFile(agentsPath, "utf8"),
  readFile(assistantPath, "utf8"), readFile(connectionsPath, "utf8"),
  readFile(billingPath, "utf8"), readFile(layoutPath, "utf8"),
]);

test("all dashboard routes share the same complete workspace navigation", () => {
  for (const href of [
    "/dashboard", "/dashboard#workflows", "/dashboard/activity",
    "/dashboard/builder", "/dashboard/ai-assistant", "/dashboard/agents",
    "/dashboard/templates", "/dashboard/connections", "/dashboard/analytics",
    "/dashboard/billing", "/dashboard/settings",
  ]) assert.ok(sidebar.includes(href), `shared navigation missing ${href}`);
  for (const [name, source] of [["agents", agents], ["assistant", assistant], ["connections", connections], ["billing", billing]]) {
    assert.match(source, /<DashboardSidebar activePage=/, `${name} does not use shared navigation`);
  }
  assert.match(layout, /import "\.\/dashboard\.css"/);
  assert.match(assistant, /activePage="assistant"/);
  assert.match(agents, /activePage="agents"/);
  assert.match(connections, /activePage="connections"/);
  assert.match(billing, /activePage="billing"/);
});

test("customer-facing integration and billing pages use Rexnora naming", () => {
  assert.doesNotMatch(connections, /Aivanta|AIVANTA/);
  assert.doesNotMatch(billing, /Aivanta|AIVANTA/);
  assert.match(connections, /REXNORA \/ INTEGRATIONS/);
  assert.match(billing, /REXNORA \/ WORKSPACE/);
});

test("Supabase secret fallback ignores empty placeholder variables", async () => {
  const googleConnections = await readFile(fileURLToPath(new URL("../app/api/integrations/google/connections/route.ts", import.meta.url)), "utf8");
  const adminClient = await readFile(fileURLToPath(new URL("../lib/supabase/admin.ts", import.meta.url)), "utf8");
  const workspaceIntegrations = await readFile(fileURLToPath(new URL("../app/api/integrations/workspace/route.ts", import.meta.url)), "utf8");
  assert.match(googleConnections, /SUPABASE_SERVICE_ROLE_KEY \|\| process\.env\.CODED_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(adminClient, /SUPABASE_SERVICE_ROLE_KEY\s*\|\| process\.env\.CODED_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workspaceIntegrations, /SUPABASE_SECRET_KEY \|\| process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
});


test("builder, workflow editor, activity list and run detail use shared navigation", async () => {
  const paths = [
    "../app/dashboard/builder/page.tsx",
    "../app/dashboard/workflows/[workflowId]/page.tsx",
    "../app/dashboard/activity/page.tsx",
    "../app/dashboard/activity/[runId]/page.tsx",
  ];
  const sources = await Promise.all(paths.map(path => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8")));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /<DashboardSidebar activePage=/, `${paths[index]} is missing shared navigation`);
  }
  assert.doesNotMatch(sources[3], /Aivanta workspace/);
});

test("mobile navigation is not height-clipped on the shared sidebar", async () => {
  const dashboardCss = await readFile(fileURLToPath(new URL("../app/dashboard/dashboard.css", import.meta.url)), "utf8");
  assert.match(dashboardCss, /\\.app-shell \\.side-nav,[\\s\\S]*?max-height:none!important;[\\s\\S]*?overflow:visible!important/s);
});
