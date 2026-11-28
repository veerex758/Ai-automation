import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const [page, api, detail, create] = await Promise.all([
  readFile(path("../app/dashboard/playbooks/page.tsx"), "utf8"),
  readFile(path("../app/api/workflows/route.ts"), "utf8"),
  readFile(path("../app/dashboard/playbooks/[playbookId]/page.tsx"), "utf8"),
  readFile(path("../app/dashboard/playbooks/new/page.tsx"), "utf8"),
]);

test("Playbooks library uses an authenticated server-generated marker without exposing saved definitions", () => {
  assert.match(api, /workflows\.view/);
  assert.match(api, /isPlaybook: isPlaybookDefinition\(row\.definition\)/);
  assert.match(api, /select\("id, name, description, status, updated_at, definition"\)/);
  assert.doesNotMatch(api.slice(api.indexOf("export async function GET"), api.indexOf("export async function POST")), /definition: row\.definition/);
  assert.match(page, /isPlaybook\?: boolean/);
  assert.match(page, /workflow\.isPlaybook !== true/);
  assert.match(page, /fetch\("\/api\/workflows\/" \+ encodeURIComponent\(workflow\.id\)/);
});

test("Playbooks library keeps batch loading, search, status filters and recovery states", () => {
  assert.match(page, /batchSize = 6/);
  assert.match(page, /Search by name or outcome/);
  assert.match(page, /statusOptions/);
  assert.match(page, /aria-pressed=\{status === option\}/);
  assert.match(page, /setReloadKey/);
  assert.match(page, /Some saved workflows could not be inspected/);
  assert.match(page, /No Playbooks saved yet/);
  assert.match(page, /No Playbooks match this view/);
});

test("Playbook cards expose version and outcome context with Control Room navigation", () => {
  assert.match(page, /version: Number\.isInteger/);
  assert.match(page, /outcome: definition\.definition\.playbook\.goal/);
  assert.match(page, /Open Control Room/);
  assert.match(detail, /REXNORA PLAYBOOKS · CONTROL ROOM/);
  assert.match(create, /href="\/dashboard\/playbooks"/);
});
