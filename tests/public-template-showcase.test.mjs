import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public homepage presents the Rexnora brand and real platform entry points", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /src="\/rexnora-lockup\.svg"/);
  assert.match(page, /src="\/rexnora-mark\.svg"/);
  assert.match(page, /Intelligence in/);
  assert.match(page, /Describe it\. Build it\. Run it\./);
  assert.match(page, /id="platform"/);
  assert.match(page, /href="\/dashboard\/templates"/);
  assert.match(page, /Workflows/);
  assert.match(page, /AI-Powered/);
  assert.match(styles, /rx-home/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
});
