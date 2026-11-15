import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/agents/[agentId]/runs/route.ts", import.meta.url), "utf8");

test("Gemini agent credentials are sent in a header, never in the request URL", () => {
  assert.ok(route.includes("https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent"));
  assert.match(route, /"x-goog-api-key": key/);
  assert.equal(route.includes("generateContent?key="), false);
  assert.equal(route.includes("encodeURIComponent(key)"), false);
});
