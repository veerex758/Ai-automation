import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const [page, api, detail] = await Promise.all([
  readFile(path("../app/dashboard/playbooks/page.tsx"), "utf8"),
  readFile(path("../app/api/workflows/route.ts"), "utf8"),
  readFile(path("../app/dashboard/playbooks/[playbookId]/page.tsx"), "utf8"),
]);

test("Playbooks library only displays validated Playbook definitions from the authorized workflow list", () => {
  assert.match(api, /workflows\.view/);
  assert.match(api, /definition\?: unknown/);
  assert.match(api, /isPlaybook: isPlaybookDefinition\(row\.definition\)/);
  assert.match(api, /candidate\.schema === "rexnora\.playbook"/);
  assert.match(api, /select\("id, name, description, status, updated_at, definition"\)/);
  assert.doesNotMatch(api.slice(api.indexOf("export async function GET"), api.indexOf("export async function POST")), /definition: row\.definition/);
  assert.match(page, /fetch\("\/api\/workflows"/);
  assert.match(page, /item\.isPlaybook === true/);
});

test("Playbooks library supports search, status filtering, refresh and empty/error states", () => {
  assert.match(page, /type Filter/);
  assert.match(page, /aria-label="Search Playbooks"/);
  assert.match(page, /aria-pressed=\{status === filter\}/);
  assert.match(page, /load\(true\)/);
  assert.match(page, /No Playbooks yet/);
  assert.match(page, /No Playbooks match this search and status filter/);
  assert.match(page, /role="alert"/);
});

test("Playbook cards open the saved Control Room and creation remains a distinct action", () => {
  assert.match(page, /\/dashboard\/playbooks\/new/);
  assert.match(page, /\/dashboard\/playbooks\//);
  assert.match(page, /Open Control Room/);
  assert.match(detail, /REXNORA PLAYBOOKS · CONTROL ROOM/);
});
