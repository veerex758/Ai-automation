import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("login surfaces use the shared premium neutral theme tokens", async () => {
  const css = await readFile(new URL("../app/login/login.css", import.meta.url), "utf8");
  assert.match(css, /\.auth-page\{background:var\(--aivanta-bg\)/);
  assert.match(css, /\.auth-card\{background:var\(--aivanta-surface\)/);
  assert.match(css, /\.auth-submit\{background:var\(--aivanta-petrol\)/);
  assert.match(css, /\.auth-form input:focus\{border-color:var\(--aivanta-brass\)/);
  assert.doesNotMatch(css, /#A9DA5E|#a9da5e|#a8d85a/);
});
