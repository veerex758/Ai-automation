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

test("Control Room exposes activation only through the server-side workflow gate", () => {
  assert.match(page, /changeStatus/);
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /status: nextStatus/);
  assert.match(page, /Activation is checked server-side/);
  assert.match(page, /Pause Playbook/);
  assert.match(page, /Activate Playbook/);
  assert.match(page, /External actions still pass the Playbook policy and review gates/);
});

test("Control Room links to the real-estate lead workspace and optional advanced graph", () => {
  assert.match(page, /href="\/dashboard\/real-estate"/);
  assert.match(page, /\/dashboard\/workflows\//);
});
