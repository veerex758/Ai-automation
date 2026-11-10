import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("shared theme defines the premium neutral palette and imports after global styles", async () => {
  const theme = await readFile(new URL("../app/aivanta-theme.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(theme, /--aivanta-bg:\s*#f4f2ed/i);
  assert.match(theme, /--aivanta-petrol:\s*#244c49/i);
  assert.match(theme, /--aivanta-brass:\s*#a98555/i);
  assert.match(theme, /\.sidebar\s*\{/);
  assert.match(theme, /\.builder-node/);
  assert.ok(layout.indexOf('./globals.css') < layout.indexOf('./aivanta-theme.css'));
});

test("login surface uses the same petrol and brass theme tokens", async () => {
  const css = await readFile(new URL("../app/login/login.css", import.meta.url), "utf8");
  assert.match(css, /\.auth-page\{background:var\(--aivanta-bg\)/);
  assert.match(css, /\.auth-card\{background:var\(--aivanta-surface\)/);
  assert.match(css, /\.auth-submit\{background:var\(--aivanta-petrol\)/);
  assert.match(css, /\.auth-form input:focus\{border-color:var\(--aivanta-brass\)/);
  assert.doesNotMatch(css, /#A9DA5E|#a9da5e|#a8d85a/);
});
