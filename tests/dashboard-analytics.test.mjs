import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("analytics reads only authenticated workspace run records and bounds its query", async () => {
  const source = await readFile(new URL("../app/dashboard/section-page.tsx", import.meta.url), "utf8");
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /getOrCreateDefaultWorkspace\(supabase\)/);
  assert.match(source, /from\("workflow_runs"\)/);
  assert.match(source, /\.eq\("workspace_id", workspace\.id\)/);
  assert.match(source, /\.limit\(100\)/);
  assert.match(source, /\.from\("workflows"\)[\s\S]*?\.eq\("workspace_id", workspace\.id\)/);
});

test("analytics derives metrics only from persisted statuses and never invents time saved", async () => {
  const source = await readFile(new URL("../app/dashboard/section-page.tsx", import.meta.url), "utf8");
  assert.match(source, /runs\.filter\(run => run\.status === "succeeded"\)/);
  assert.match(source, /runs\.filter\(run => run\.status === "failed"\)/);
  assert.match(source, /successRate/);
  assert.match(source, /No activity or time-saved estimates are fabricated/);
  assert.doesNotMatch(source, /Estimated time saved/);
});
