import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const [dashboard, sections, sidebar, agents, playbooks, playbookLibrary, connections, billing, layout] = await Promise.all([
  readFile(path("../app/dashboard/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/section-page.tsx"), "utf8"),
  readFile(path("../app/dashboard/dashboard-sidebar.tsx"), "utf8"),
  readFile(path("../app/dashboard/agents/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/playbooks/new/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/playbooks/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/connections/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/billing/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/layout.tsx"), "utf8"),
]);

test("overview navigation exposes Playbooks as the only customer-facing workflow authoring entry", () => {
  for (const href of [
    "/dashboard", "/dashboard#workflows", "/dashboard/activity",
    "/dashboard/playbooks", "/dashboard/agents", "/dashboard/templates",
    "/dashboard/integrations", "/dashboard/connections", "/dashboard/analytics",
    "/dashboard/billing", "/dashboard/settings", "/dashboard/workspaces",
  ]) assert.ok(sidebar.includes(href), "missing shared navigation destination: " + href);
  assert.ok(sidebar.includes("key={item.key} href={item.href}"), "shared navigation must render its configured links");
  assert.match(dashboard, /id="workflows"/);
  assert.doesNotMatch(sidebar, /href: "\/dashboard\/builder"|href: "\/dashboard\/ai-assistant"/);
});

test("shared sidebar opens the saved Playbooks library and exposes no competing builder or assistant entry", () => {
  assert.ok(sidebar.includes('label: "Playbooks", icon: "◇", href: "/dashboard/playbooks", key: "playbooks"'));
  assert.doesNotMatch(sidebar, /href: "\/dashboard\/builder"|href: "\/dashboard\/ai-assistant"/);
  assert.match(playbookLibrary, /<DashboardSidebar activePage="playbooks"/);
  assert.match(playbookLibrary, /rexnora\.playbook/);
  assert.match(playbookLibrary, /Open Control Room/);
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
  assert.match(google, /getAdminSupabaseConfig|createAdminClient/);
  assert.match(workspace, /getAdminSupabaseConfig|createAdminClient/);
  assert.match(admin, /isRexnoraStagingPreview/);
  assert.match(admin, /isRexnoraStagingPreview[\s\S]*CODED_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(admin, /VERCEL_GIT_COMMIT_REF/);
});


test("dashboard sends all new automation creation through outcome-first Playbooks", () => {
  assert.match(dashboard, /New Playbook/);
  assert.match(dashboard, /Create a Playbook/);
  assert.match(dashboard, /href="\/dashboard\/playbooks\/new"/);
  assert.match(dashboard, /router\.push\("\/dashboard\/playbooks\/new"\)/);
  assert.doesNotMatch(dashboard, /workflowTemplates|createFromTemplate|openTemplateSetup|Create workflow/);
  assert.match(dashboard, /async function saveWorkflow[\s\S]*method: "PATCH"/);
  assert.match(dashboard, /Open builder/);
});


test("workspace and team navigation is reachable from the shared workspace switch", () => {
  assert.match(sidebar, /key: "workspaces"/);
  assert.match(sidebar, /className="workspace-switch" href="\/dashboard\/workspaces"/);
  assert.match(sections, /href="\/dashboard\/workspaces"/);
});

test("dashboard workflow requests handle empty and non-JSON responses without leaking JSON parse errors", () => {
  assert.match(dashboard, /async function readJsonResponse<T>\(response: Response, failureLabel: string\)/);
  assert.match(dashboard, /const body = await response\.text\(\)/);
  assert.match(dashboard, /invalid response/);
  assert.match(dashboard, /empty response/);
  assert.doesNotMatch(dashboard, /const result = await response\.json\(\)/);
  assert.match(dashboard, /workflowLoadError/);
  assert.match(dashboard, /Try again/);
});
