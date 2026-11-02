import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const globalCss = read("app/globals.css");
const dashboardCss = read("app/dashboard/dashboard.css");
const activity = read("app/dashboard/activity/page.tsx");
const integrations = read("app/dashboard/integrations/integration-directory.tsx");
const section = read("app/dashboard/section-page.tsx");

test("premium neutral design tokens replace the previous lime-first palette", () => {
  assert.match(globalCss, /--aivanta-ivory:#F5F3EE/);
  assert.match(globalCss, /--aivanta-forest:#183B32/);
  assert.match(globalCss, /--aivanta-champagne:#C2A879/);
  assert.match(dashboardCss, /Premium neutral workspace system/);
});

test("Activity Center reads only workspace-scoped run and safe step metadata", () => {
  assert.match(activity, /getOrCreateDefaultWorkspace/);
  assert.match(activity, /from\("workflow_runs"\)/);
  assert.match(activity, /\.eq\("workspace_id", workspace\.id\)/);
  assert.match(activity, /from\("workflow_run_steps"\)\.select\("id, run_id, status"\)/);
  assert.doesNotMatch(activity, /select\([^\n]*(?:result|input|output|provider_payload)/i);
});

test("Activity Center distinguishes dry-runs from actual live executions", () => {
  assert.match(activity, /run\.mode === "dry_run"/);
  assert.match(activity, /Dry-run passed/);
  assert.match(activity, /A dry-run does not perform external actions/);
});

test("Integration directory has working search and honest setup states", () => {
  assert.match(integrations, /useState/);
  assert.match(integrations, /setSearch/);
  assert.match(integrations, /Configure in builder/);
  assert.match(integrations, /Setup required/);
  assert.match(section, /<IntegrationDirectory\/>/);
  assert.match(section, /<GoogleOAuthConnections\/>/);
});
