import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\\.(tsx|ts|jsx|js)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("public homepage presents the Rexnora brand and real platform entry points", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/aivanta-theme.css", import.meta.url), "utf8");
  assert.match(page, /src="\\/rexnora-lockup\\.svg"/);
  assert.match(page, /src="\\/rexnora-mark\\.svg"/);
  assert.match(page, /Intelligence in/);
  assert.match(page, /Describe it\\. Build it\\. Run it\\./);
  assert.match(page, /id="platform"/);
  assert.match(page, /href="\\/dashboard\\/templates"/);
  assert.match(page, /Workflows/);
  assert.match(page, /AI-Powered/);
  assert.match(styles, /\\.rx-home/);
  assert.match(styles, /@media\\s*\\(\\s*max-width:\\s*700px\\s*\\)/);
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
