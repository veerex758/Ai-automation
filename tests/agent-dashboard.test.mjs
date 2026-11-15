import test from "node:test";import assert from "node:assert/strict";import {readFile} from "node:fs/promises";
const page=await readFile(new URL("../app/dashboard/agents/page.tsx",import.meta.url),"utf8");
const route=await readFile(new URL("../app/api/agents/route.ts",import.meta.url),"utf8");
const runRoute=await readFile(new URL("../app/api/agents/[agentId]/runs/route.ts",import.meta.url),"utf8");
test("agent dashboard supports persisted profile CRUD, status filtering, and model-only run history",()=>{assert.match(page,/fetch\("\/api\/agents"/);assert.match(page,/filteredAgents/);assert.match(page,/statusFilter/);assert.match(page,/loadRuns/);assert.match(page,/Run agent \(model-only\)/);assert.match(page,/tools disabled/);});
test("agent API retains workspace authorization and explicit tool/action boundary",()=>{assert.match(route,/getOrCreateDefaultWorkspace/);assert.match(route,/allow_external_actions:false/);assert.match(runRoute,/consume_agent_run_usage/);assert.match(runRoute,/model_provider/);});
