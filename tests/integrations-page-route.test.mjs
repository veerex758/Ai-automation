import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("dashboard Integrations route renders the registry directory instead of redirecting to connected accounts", async () => {
  const source = await readFile(new URL("../app/dashboard/integrations/page.tsx", import.meta.url), "utf8");
  assert.match(source, /DashboardSectionPage section="integrations"/);
  assert.doesNotMatch(source, /redirect\(["']\/dashboard\/connections["']\)/);
});

test("Integrations and Connected accounts have separate navigation destinations", async () => {
  const sidebar = await readFile(new URL("../app/dashboard/dashboard-sidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /label: "Integrations"[^\n]*href: "\/dashboard\/integrations"[^\n]*key: "integrations"/);
  assert.match(sidebar, /label: "Connected accounts"[^\n]*href: "\/dashboard\/connections"[^\n]*key: "connections"/);
});
