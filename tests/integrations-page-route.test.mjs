import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("dashboard Integrations navigation resolves to the current Connections manager", async () => {
  const source = await readFile(new URL("../app/dashboard/integrations/page.tsx", import.meta.url), "utf8");
  assert.match(source, /redirect\(["']\/dashboard\/connections["']\)/);
});
