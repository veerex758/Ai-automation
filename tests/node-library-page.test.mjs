import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/dashboard/nodes/page.tsx", import.meta.url), "utf8");
const registry = readFileSync(new URL("../app/api/workflows/actions/route.ts", import.meta.url), "utf8");

test("node library loads the authenticated first-party node registry", () => {
  assert.match(page, /fetch\("\/api\/workflows\/actions"/);
  assert.match(registry, /getPublicNodeCatalog\(\)/);
  assert.match(page, /Built in/);
});

test("node library does not misrepresent community packages as installed", () => {
  assert.match(page, /Community installs/);
  assert.match(page, /Curated community nodes are next/);
  assert.match(page, /not a separately installed community package/);
  assert.doesNotMatch(page, /Install now/);
});

test("node library supports search, category filtering and builder navigation", () => {
  assert.match(page, /setSearch/);
  assert.match(page, /setCategory/);
  assert.match(page, /Use in builder/);
});
