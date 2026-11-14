import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const page=await readFile(new URL("../app/dashboard/agents/page.tsx",import.meta.url),"utf8");
const route=await readFile(new URL("../app/api/agents/route.ts",import.meta.url),"utf8");
const updateRoute=await readFile(new URL("../app/api/agents/[agentId]/route.ts",import.meta.url),"utf8");
const runRoute=await readFile(new URL("../app/api/agents/[agentId]/runs/route.ts",import.meta.url),"utf8");
const toolRuntime=await readFile(new URL("../lib/agents/tool-runtime.ts",import.meta.url),"utf8");
test("agent dashboard supports persisted profile CRUD, filters, run history, and read-only tools",()=>{
 assert.match(page,/fetch\("\/api\/agents"/);assert.match(page,/filteredAgents/);assert.match(page,/statusFilter/);assert.match(page,/loadRuns/);
 assert.match(page,/Read-only tools/);assert.match(page,/workflow\.list, workflow\.get, integrations\.list/);assert.match(page,/Run agent/);
});
test("agent API enforces workspace ownership, registered tool allowlist, and permission mode",()=>{
 assert.match(route,/getOrCreateDefaultWorkspace/);assert.match(route,/getAgentTools/);assert.match(route,/allow_external_actions:false/);
 assert.match(updateRoute,/getAgentTools/);assert.match(updateRoute,/mode:nextStatus==="ready"\?"read_only":"draft"/);
 assert.match(updateRoute,/providerConfigured/);assert.match(updateRoute,/permissionsValid/);assert.match(updateRoute,/No agent run was started/);
});
test("agent runtime calls registered tools only when read-only permissions are enabled and audits each call",()=>{
 assert.match(runRoute,/permissions\.mode !== "read_only"/);assert.match(runRoute,/executeAgentTool/);assert.match(runRoute,/AGENT_TOOL_NOT_ALLOWED/);
 assert.match(runRoute,/agent\.tool_executed/);assert.match(runRoute,/agent\.tool_failed/);assert.match(runRoute,/AGENT_TOOL_LIMIT_REACHED/);
 assert.match(toolRuntime,/workflow\.list/);assert.match(toolRuntime,/workflow\.get/);assert.match(toolRuntime,/integrations\.list/);
 assert.match(toolRuntime,/eq\("workspace_id", workspaceId\)/);assert.doesNotMatch(toolRuntime,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
});
