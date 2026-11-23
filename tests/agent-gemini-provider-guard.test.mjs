import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const createRoute = await readFile(new URL("../app/api/agents/route.ts", import.meta.url), "utf8");
const updateRoute = await readFile(new URL("../app/api/agents/[agentId]/route.ts", import.meta.url), "utf8");
const runRoute = await readFile(new URL("../app/api/agents/[agentId]/runs/route.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/dashboard/agents/page.tsx", import.meta.url), "utf8");

test("agent creation rejects non-Gemini providers instead of silently switching providers", () => {
  assert.match(createRoute, /v\.model_provider!==undefined&&v\.model_provider!=="gemini"/);
  assert.match(createRoute, /Rexnora agents currently support Gemini only/);
  assert.match(createRoute, /const provider="gemini"/);
});

test("agent updates and readiness checks require configured Gemini credentials", () => {
  assert.match(updateRoute, /update\.model_provider!=="gemini"/);
  assert.match(updateRoute, /agent\.model_provider==="gemini"&&Boolean\(process\.env\.GEMINI_API_KEY/);
});

test("agent execution fails closed for legacy non-Gemini records before usage is consumed", () => {
  const guard = runRoute.indexOf('if (agent.model_provider !== "gemini")');
  const usage = runRoute.indexOf('consume_agent_run_usage');
  assert.ok(guard >= 0, "Gemini-only runtime guard exists");
  assert.ok(usage > guard, "provider guard runs before usage metering");
});

test("agent dashboard presents Gemini as the only selectable provider", () => {
  assert.match(dashboard, /value="Google Gemini" readOnly/);
  assert.match(dashboard, /Tool-call trace/);
  assert.match(dashboard, /item\.details\.tool_id/);
  assert.doesNotMatch(dashboard, /<option value="openai">OpenAI<\/option>/);
});
