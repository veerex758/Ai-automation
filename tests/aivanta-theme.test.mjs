import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("shared theme defines the Rexnora palette and loads after global styles", async () => {
  const theme = await readFile(new URL("../app/aivanta-theme.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(theme, /--rexnora-obsidian:\s*#0B0F14/i);
  assert.match(theme, /--rexnora-slate:\s*#1A1F29/i);
  assert.match(theme, /--rexnora-charcoal:\s*#2A2F3A/i);
  assert.match(theme, /--rexnora-blue:\s*#3B82F6/i);
  assert.match(theme, /--rexnora-lavender:\s*#8B5CF6/i);
  assert.match(theme, /--rexnora-ivory:\s*#F8FAFC/i);
  assert.match(theme, /\.sidebar/);
  assert.match(theme, /\.builder-primary-button/);
  assert.ok(layout.indexOf("./globals.css") < layout.indexOf("./aivanta-theme.css"));
  assert.match(layout, /Rexnora — Intelligence in motion/);
});

test("login surface uses the shared dark theme tokens", async () => {
  const css = await readFile(new URL("../app/login/login.css", import.meta.url), "utf8");
  assert.match(css, /\.auth-page\{background:var\(--aivanta-bg\)/);
  assert.match(css, /\.auth-card\{background:var\(--aivanta-surface\)/);
  assert.match(css, /\.auth-submit\{background:var\(--aivanta-petrol\)/);
  assert.match(css, /\.auth-form input:focus\{border-color:var\(--aivanta-brass\)/);
  assert.doesNotMatch(css, /#A9DA5E|#a9da5e|#a8d85a/);
});

test("Rexnora homepage implements every approved reference section", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const theme = await readFile(new URL("../app/aivanta-theme.css", import.meta.url), "utf8");
  const logo = await readFile(new URL("../public/rexnora-mark.svg", import.meta.url), "utf8");
  for (const text of ["Intelligence in", "motion.", "Describe it. Build it. Run it.", "Build. Automate.", "Scale.", "Workflows", "Marketplace", "Developer", "Enterprise Ready", "Let your workflow do the busywork."]) assert.ok(page.includes(text), "homepage missing " + text);
  for (const internalGuideline of ["Brand Colour System", "Typography", "Brand Values", "Obsidian"]) assert.ok(!page.includes(internalGuideline), "homepage should not expose internal brand guidelines: " + internalGuideline);
  for (const hex of ["#0B0F14", "#1A1F29", "#2A2F3A", "#3B82F6", "#8B5CF6", "#F8FAFC", "#94A3B8"]) assert.ok(page.includes(hex) || theme.includes(hex), "palette missing " + hex);
  assert.match(page, /Inter/);
  assert.match(page, /Geist/);
  assert.match(logo, /Rexnora/);
  assert.match(theme, /\.rx-swatches/);
  assert.match(theme, /\.rx-dashboard-preview/);
  assert.match(theme, /@media\(max-width:700px\)/);
});
