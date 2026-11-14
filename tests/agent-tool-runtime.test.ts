import test from "node:test";
import assert from "node:assert/strict";
import { executeAgentTool, getAgentToolByName, getAgentTools } from "../lib/agents/tool-runtime";

test("agent tool registry exposes only approved read-only workspace tools", () => {
  const tools = getAgentTools(["workflow.list", "workflow.get", "integrations.list"]);
  assert.deepEqual(tools.map((tool) => tool.id), ["workflow.list", "workflow.get", "integrations.list"]);
  assert.deepEqual(tools.map((tool) => tool.name), ["workflow_list", "workflow_get", "integration_list"]);
  assert.equal(getAgentToolByName("workflow_list")?.id, "workflow.list");
  assert.throws(() => getAgentTools(["workflow.delete"]), /AGENT_TOOL_NOT_ALLOWED/);
});

test("workflow list tool is scoped to the current workspace and applies status filters", async () => {
  const calls: Array<[string, unknown]> = [];
  const query = {
    select() { return this; },
    eq(column: string, value: unknown) { calls.push([column, value]); return this; },
    order() { return this; },
    limit() { return this; },
    then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [{ id: "wf-1" }], error: null }).then(resolve); },
  };
  const supabase = { from(table: string) { calls.push(["table", table]); return query; } } as never;
  const result = await executeAgentTool(supabase, "workspace-123", "workflow.list", { status: "active" });
  assert.deepEqual(result, { workflows: [{ id: "wf-1" }] });
  assert.ok(calls.some(([key, value]) => key === "workspace_id" && value === "workspace-123"));
  assert.ok(calls.some(([key, value]) => key === "status" && value === "active"));
});

test("workflow get rejects malformed IDs before querying workspace data", async () => {
  let queried = false;
  const supabase = { from() { queried = true; throw new Error("must not query"); } } as never;
  await assert.rejects(() => executeAgentTool(supabase, "workspace-123", "workflow.get", { workflow_id: "not-a-uuid" }), /AGENT_TOOL_INVALID_ARGUMENT/);
  assert.equal(queried, false);
});
