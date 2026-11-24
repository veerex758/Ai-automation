import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const [dashboard, sections, sidebar, agents, playbooks, connections, billing, layout] = await Promise.all([
  readFile(path("../app/dashboard/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/section-page.tsx"), "utf8"),
  readFile(path("../app/dashboard/dashboard-sidebar.tsx"), "utf8"),
  readFile(path("../app/dashboard/agents/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/playbooks/new/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/connections/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/billing/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/layout.tsx"), "utf8"),
]);

test("overview navigation exposes Playbooks as the only customer-facing workflow authoring entry", () => {
  for (const href of [
    "/dashboard", "/dashboard#workflows", "/dashboard/activity",
    "/dashboard/playbooks/new", "/dashboard/agents", "/dashboard/templates",
    "/dashboard/integrations", "/dashboard/connections", "/dashboard/analytics",
    "/dashboard/billing", "/dashboard/settings",
  ]) assert.ok(dashboard.includes(href), "missing dashboard navigation destination: " + href);
  assert.match(dashboard, /<Link key=\{item\.label\} href=\{item\.href\}/);
  assert.match(dashboard, /id="workflows"/);
  assert.doesNotMatch(dashboard, /href: "\/dashboard\/builder"|href: "\/dashboard\/ai-assistant"/);
});

test("shared sidebar exposes Playbooks and no competing builder or assistant entry", () => {
  assert.match(sidebar, /label: "Playbooks".*href: "\/dashboard\/playbooks\/new".*key: "playbooks"/);
  assert.doesNotMatch(sidebar, /href: "\/dashboard\/builder"|href: "\/dashboard\/ai-assistant"/);
  assert.match(playbooks, /<DashboardSidebar activePage="playbooks"/);
  assert.match(agents, /<DashboardSidebar activePage="agents"/);
  assert.match(connections, /<DashboardSidebar activePage="connections"/);
  assert.match(billing, /<DashboardSidebar activePage="billing"/);
  assert.match(layout, /import "\.\/dashboard\.css"/);
});

test("legacy authoring URLs redirect to the canonical Playbook setup", async () => {
  const [builder, assistant] = await Promise.all([
    readFile(path("../app/dashboard/builder/page.tsx"), "utf8"),
    readFile(path("../app/dashboard/ai-assistant/page.tsx"), "utf8"),
  ]);
  assert.match(builder, /redirect\("\/dashboard\/playbooks\/new"\)/);
  assert.match(assistant, /redirect\("\/dashboard\/playbooks\/new"\)/);
});

test("section pages retain consistent shared navigation", () => {
  assert.match(sections, /import DashboardSidebar from "\.\/dashboard-sidebar"/);
  assert.match(sections, /activePage=\{section\}/);
});

test("customer-facing integration and billing pages use Rexnora naming", () => {
  assert.doesNotMatch(connections, /Aivanta|AIVANTA/);
  assert.doesNotMatch(billing, /Aivanta|AIVANTA/);
  assert.match(connections, /<strong>Connected accounts<\/strong>/);
  assert.match(billing, /REXNORA \/ WORKSPACE/);
});

test("workflow editor, activity list and run detail retain shared navigation", async () => {
  const paths = [
    "../app/dashboard/workflows/[workflowId]/page.tsx",
    "../app/dashboard/activity/page.tsx",
    "../app/dashboard/activity/[runId]/page.tsx",
  ];
  const sources = await Promise.all(paths.map((item) => readFile(path(item), "utf8")));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /<DashboardSidebar activePage=/, paths[index] + " is missing shared navigation");
  }
  assert.doesNotMatch(sources[2], /Aivanta workspace/);
});

test("Supabase staging-only secret resolution ignores empty placeholder variables", async () => {
  const google = await readFile(path("../app/api/integrations/google/connections/route.ts"), "utf8");
  const admin = await readFile(path("../lib/supabase/admin.ts"), "utf8");
  const workspace = await readFile(path("../app/api/integrations/workspace/route.ts"), "utf8");
  assert.match(google, /getAdminSupabaseConfig/);
  assert.match(workspace, /getAdminSupabaseConfig/);
  assert.match(admin, /isRexnoraStagingPreview/);
  assert.match(admin, /isRexnoraStagingPreview[\s\S]*CODED_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(admin, /VERCEL_GIT_COMMIT_REF/);
});
