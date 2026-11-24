import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/dashboard/playbooks/[playbookId]/page.tsx", import.meta.url), "utf8");

test("saved Playbook routes to a Control Room that loads the saved version", () => {
  assert.match(page, /useParams/);
  assert.match(page, /\/api\/workflows\//);
  assert.match(page, /\/definition/);
  assert.match(page, /Version \{workflow\.version\}/);
  assert.match(page, /REXNORA PLAYBOOKS · CONTROL ROOM/);
});

test("Control Room exposes the saved business rules, action permissions and review policy", () => {
  assert.match(page, /Business rules/);
  assert.match(page, /Action permissions/);
  assert.match(page, /Human review policy/);
  assert.match(page, /confidenceThreshold/);
  assert.match(page, /permissionCopy/);
});

test("Control Room does not allow activation or execution", () => {
  assert.match(page, /Activation is locked until the durable runtime enforces/);
  assert.doesNotMatch(page, /\/activate|\/execute|\/dispatch|status:\s*["']active["']/);
});

test("Control Room links to the real-estate lead workspace and optional advanced graph", () => {
  assert.match(page, /href="\/dashboard\/real-estate"/);
  assert.match(page, /\/dashboard\/workflows\//);
});
