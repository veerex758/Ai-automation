import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const css = await readFile(fileURLToPath(new URL("../app/dashboard/dashboard.css", import.meta.url)), "utf8");

test("dashboard uses the Rexnora dark palette on overview and section routes", () => {
  assert.match(css, /\.app-shell\{[^}]*background:#0B0F14!important/s);
  assert.match(css, /\.app-shell:not\(\.dashboard-overview-page\) \.section-info-card[^}]*background:#1A1F29!important/s);
  assert.match(css, /\.app-shell:not\(\.dashboard-overview-page\) \.dashboard-topbar[^}]*background:#0B0F14!important/s);
});

test("mobile dashboard navigation stacks brand and provides a non-overlapping two-column menu", () => {
  assert.match(css, /@media\(max-width:720px\)[\s\S]*?\.app-shell \.sidebar\{[^}]*flex-direction:column!important/s);
  assert.match(css, /\.app-shell \.side-nav,[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/s);
  assert.match(css, /\.app-shell \.side-link[^}]*white-space:nowrap!important/s);
});
