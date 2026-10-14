import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../lib/supabase/workspace.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const workspaceModule = { exports: {} };
new Function("exports", "require", "module", compiled)(
  workspaceModule.exports,
  require,
  workspaceModule,
);
const { getOrCreateDefaultWorkspace } = workspaceModule.exports;

function mockSupabase(plans) {
  const calls = [];
  const client = {
    from(table) {
      const builder = {
        table,
        select(columns) { calls.push({ table, method: "select", columns }); return builder; },
        eq(column, value) { calls.push({ table, method: "eq", column, value }); return builder; },
        order(column, options) { calls.push({ table, method: "order", column, options }); return builder; },
        limit(value) { calls.push({ table, method: "limit", value }); return builder; },
        insert(values) { calls.push({ table, method: "insert", values }); builder.inserted = true; return builder; },
        maybeSingle() { return Promise.resolve(next(table, "maybeSingle")); },
        single() { return Promise.resolve(next(table, "single")); },
        then(resolve, reject) { return Promise.resolve(next(table, "then")).then(resolve, reject); },
      };
      return builder;
    },
  };

  function next(table, terminal) {
    const queue = plans[table]?.[terminal];
    if (!queue?.length) throw new Error(`Unexpected ${table}.${terminal} query in mock`);
    return queue.shift();
  }

  return { client, calls };
}

const user = { id: "user-1", user_metadata: { full_name: "Aivanta Owner" } };
const existingWorkspace = { id: "workspace-1", name: "Aivanta Owner's workspace" };

test("repairs a missing owner membership and returns the existing workspace", async () => {
  const { client, calls } = mockSupabase({
    workspaces: { maybeSingle: [{ data: existingWorkspace, error: null }] },
    workspace_members: {
      maybeSingle: [{ data: null, error: null }],
      then: [{ data: null, error: null }],
    },
  });

  const result = await getOrCreateDefaultWorkspace(client, user);
  assert.deepEqual(result, existingWorkspace);
  assert.ok(calls.some((call) => call.table === "workspace_members" && call.method === "insert"
    && call.values.workspace_id === existingWorkspace.id
    && call.values.user_id === user.id
    && call.values.role === "owner"));
});

test("treats a duplicate-key race as success only after re-reading the membership", async () => {
  const { client, calls } = mockSupabase({
    workspaces: { maybeSingle: [{ data: existingWorkspace, error: null }] },
    workspace_members: {
      maybeSingle: [
        { data: null, error: null },
        { data: { workspace_id: existingWorkspace.id }, error: null },
      ],
      then: [{ data: null, error: { code: "23505", message: "duplicate key" } }],
    },
  });

  const result = await getOrCreateDefaultWorkspace(client, user);
  assert.deepEqual(result, existingWorkspace);
  assert.equal(calls.filter((call) => call.table === "workspace_members" && call.method === "maybeSingle").length, 2);
});

test("does not hide a non-duplicate membership insert failure", async () => {
  const insertError = { code: "42501", message: "permission denied" };
  const { client, calls } = mockSupabase({
    workspaces: { maybeSingle: [{ data: existingWorkspace, error: null }] },
    workspace_members: {
      maybeSingle: [{ data: null, error: null }],
      then: [{ data: null, error: insertError }],
    },
  });

  await assert.rejects(getOrCreateDefaultWorkspace(client, user), (error) => error === insertError);
  assert.equal(calls.filter((call) => call.table === "workspace_members" && call.method === "maybeSingle").length, 1);
});

test("does not report workspace creation as successful when owner membership fails", async () => {
  const createdWorkspace = { id: "workspace-2", name: "Aivanta Owner's workspace" };
  const insertError = { code: "42501", message: "membership insert denied" };
  const { client, calls } = mockSupabase({
    workspaces: {
      maybeSingle: [{ data: null, error: null }],
      single: [{ data: createdWorkspace, error: null }],
    },
    workspace_members: {
      maybeSingle: [{ data: null, error: null }],
      then: [{ data: null, error: insertError }],
    },
  });

  await assert.rejects(getOrCreateDefaultWorkspace(client, user), (error) => error === insertError);
  assert.ok(calls.some((call) => call.table === "workspaces" && call.method === "insert"));
});
