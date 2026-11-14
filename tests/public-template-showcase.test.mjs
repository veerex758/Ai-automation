import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".tsx", ".ts", ".jsx", ".js"].some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  }));
  return nested.flat();
}

test("public homepage presents the Rexnora brand and real platform entry points", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/aivanta-theme.css", import.meta.url), "utf8");
  assert.ok(page.includes('src="/rexnora-lockup.svg"'));
  assert.ok(page.includes('src="/rexnora-mark.svg"'));
  assert.ok(page.includes("Intelligence in"));
  assert.ok(page.includes("Describe it. Build it. Run it."));
  assert.ok(page.includes('id="platform"'));
  assert.ok(page.includes('href="/dashboard/templates"'));
  assert.ok(page.includes("Workflows"));
  assert.ok(page.includes("AI-Powered"));
  assert.ok(styles.includes(".rx-home"));
  assert.ok(styles.includes("@media(max-width:700px)"));
});

test("application pages do not reference the retired Aivanta logo asset", async () => {
  const appDirectory = new URL("../app/", import.meta.url);
  const files = await sourceFiles(appDirectory);
  const matches = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes("/aivanta-mark.svg")) {
      matches.push(relative(appDirectory.pathname, file));
    }
  }
  assert.deepEqual(matches, [], "Replace retired Aivanta logo references with the Rexnora brand assets.");
});
