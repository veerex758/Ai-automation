import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const route = await readFile(new URL("../app/api/integrations/workspace/test/route.ts", import.meta.url), "utf8");
test("integration test endpoint bounds actual request bytes before parsing", () => {
  assert.match(route, /declaredLength > 2 \* 1024/);
  assert.match(route, /request\.text\(\)/);
  assert.match(route, /Buffer\.byteLength\(rawBody, "utf8"\) > 2 \* 1024/);
  assert.match(route, /Integration test request exceeds the 2 KB limit/);
});
