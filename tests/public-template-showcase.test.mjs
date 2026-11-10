import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public homepage showcases real starter template entry points", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /id="templates"/);
  assert.match(page, /Lead Capture &amp; Welcome Email/);
  assert.match(page, /Support Ticket Triage/);
  assert.match(page, /Lead Follow-up/);
  assert.match(page, /href="\/dashboard\/templates"/);
  assert.match(styles, /\.pilot-templates \.reference-feature-grid/);
  assert.match(styles, /@media\(max-width:760px\)/);
});
