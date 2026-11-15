import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const css = await readFile(fileURLToPath(new URL("../app/dashboard/dashboard.css", import.meta.url)), "utf8");
const sidebarSource = await readFile(fileURLToPath(new URL("../app/dashboard/dashboard-sidebar.tsx", import.meta.url)), "utf8");

test("dashboard uses the Rexnora dark palette on overview and section routes", () => {
  assert.match(css, /\.app-shell\{[^}]*background:#0B0F14!important/s);
  assert.match(css, /\.app-shell:not\(\.dashboard-overview-page\) \.section-info-card[^}]*background:#1A1F29!important/s);
  assert.match(css, /\.app-shell:not\(\.dashboard-overview-page\) \.settings-section-card\{[^}]*background:#1A1F29!important/s);
  assert.match(css, /\.app-shell:not\(\.dashboard-overview-page\) \.dashboard-topbar[^}]*background:#0B0F14!important/s);
});

test("mobile dashboard navigation stacks brand and provides a non-overlapping two-column menu", () => {
  assert.match(css, /@media\(max-width:720px\)[\s\S]*?\.app-shell \.sidebar\{[^}]*flex-direction:column!important/s);
  assert.match(css, /\.app-shell \.side-nav,[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/s);
  assert.match(css, /\.app-shell \.side-link[^}]*white-space:nowrap!important/s);
});


test("overview template chooser and its actions use dark surfaces with light text", () => {
  assert.match(css, /\.dashboard-overview-page \.quick-start-section\{[^}]*background:#111722!important/s);
  assert.match(css, /\.dashboard-overview-page \.quick-template-card\{[^}]*background:#1A1F29!important/s);
  assert.match(css, /\.dashboard-overview-page \.quick-template-card>button\{[^}]*background:#111722!important/s);
  assert.match(css, /\.dashboard-overview-page \.quick-template-card h3\{color:#F8FAFC!important\}/);
});

test("mobile navigation does not trap lower links such as Settings in a nested scroll box", () => {
  assert.match(css, /\.app-shell \.side-nav,[\s\S]*?max-height:none!important;[\s\S]*?overflow:visible!important/s);
  assert.match(sidebarSource, /\{ label: "Settings", icon: "⚙", href: "\/dashboard\/settings", key: "settings" \}/);
});


test("AI assistant, agents, integrations, billing and run details use dark Rexnora surfaces", async () => {
  const paths = [
    "../app/dashboard/ai-assistant/assistant.css",
    "../app/dashboard/agents/agents.css",
    "../app/dashboard/connections/connections.css",
    "../app/dashboard/billing/billing.css",
    "../app/dashboard/activity/[runId]/run-detail.css",
  ];
  const sources = await Promise.all(paths.map(path => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8")));
  assert.match(sources[0], /\.ai-assistant-shell\{background:#0B0F14!important/);
  assert.match(sources[1], /\.agents-shell \.agent-editor input[^}]*background:#111722!important/s);
  assert.match(sources[2], /\.app-shell \.connection-card\{[^}]*background:#1A1F29/s);
  assert.match(sources[3], /\.billing-app-shell \.billing-panel[^}]*background:#1A1F29!important/s);
  assert.match(sources[4], /\.run-detail-app-shell \.run-summary-card[^}]*background:#1A1F29!important/s);
});
