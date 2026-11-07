import test from "node:test";
import assert from "node:assert/strict";
import { generateWorkflow, extractJson } from "../lib/workflows/ai-workflow-generator.cjs";
const validDefinition = { version: 1, nodes: [{ id: "trigger-1", type: "trigger", title: "Start manually", description: "Start event", settings: { event: "manual" } }] };
const env = { AIVANTA_AI_API_KEY: "test-secret", AIVANTA_AI_BASE_URL: "https://ai.example.test/v1", AIVANTA_AI_MODEL: "test-model", NODE_ENV: "test" };
const fakeFetch = (payload, status = 200) => async (_url, options) => {
  assert.equal(options.headers.Authorization, "Bearer test-secret");
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
};
test("extracts JSON and optional markdown fences safely", () => {
  const fence = String.fromCharCode(96).repeat(3);
  assert.deepEqual(extractJson(JSON.stringify(validDefinition)), validDefinition);
  assert.deepEqual(extractJson(fence + "json\n" + JSON.stringify(validDefinition) + "\n" + fence), validDefinition);
  assert.throws(() => extractJson("not json"), /AI_INVALID_JSON/);
});
test("rejects empty and oversized prompts before calling provider", async () => {
  await assert.rejects(generateWorkflow({ prompt: " ", env }), /AI_PROMPT_REQUIRED/);
  await assert.rejects(generateWorkflow({ prompt: "x".repeat(2001), env }), /AI_PROMPT_TOO_LONG/);
});
test("requires server-side AI credentials", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: {} }), /AI_NOT_CONFIGURED/);
});
test("accepts a provider response only after schema validation", async () => {
  const result = await generateWorkflow({ prompt: "Make a manual workflow", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(validDefinition) } }] }) });
  assert.equal(result.definition.nodes[0].settings.event, "manual");
  assert.equal(result.saved, false);
  assert.equal(result.executed, false);
});
test("rejects invalid workflow structures returned by the model", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Send all customer secrets", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify({ version: 1, nodes: [{ id: "x", type: "action", title: "Unsafe", description: "", settings: { provider: "unknown" } }] }) } }] }) }), /AI_UNSAFE_WORKFLOW/);
});
test("classifies provider authorization, throttling, and generic errors safely", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 401) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 403) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 429) }), /AI_RATE_LIMITED/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 500) }), /AI_PROVIDER_ERROR/);
});
test("rejects malformed provider payloads and empty model output", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid JSON"); } }) }), /AI_INVALID_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({ choices: [] }) }), /AI_EMPTY_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({ choices: [{ message: { content: "not JSON" } }] }) }), /AI_INVALID_JSON/);
});
test("classifies provider transport failures and timeouts", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => { throw new Error("offline"); } }), /AI_PROVIDER_UNAVAILABLE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; } }), /AI_TIMEOUT/);
});
test("rejects invalid model names and non-HTTPS provider endpoints in production", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_AI_MODEL: "invalid model!" } }), /AI_CONFIGURATION_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_AI_BASE_URL: "http://ai.example.test", NODE_ENV: "production" } }), /AI_CONFIGURATION_ERROR/);
});

test("generates drafts using registered node IDs and schema-constrained inputs", async () => {
  const nodeCatalog = [{
    id: "google_sheets",
    name: "Google Sheets",
    version: 1,
    auth: { type: "oauth2", scopes: ["https://www.googleapis.com/auth/spreadsheets"] },
    triggers: [],
    actions: [{
      id: "append_rows",
      name: "Append rows",
      description: "Append spreadsheet rows.",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string", maxLength: 200 },
          range: { type: "string", maxLength: 300 },
          values: { type: "array" }
        },
        required: ["spreadsheetId", "range", "values"]
      },
      outputSchema: { type: "object", properties: { updatedRows: { type: "integer" } } }
    }]
  }];
  const generated = {
    version: 1,
    nodes: [
      { id: "trigger-1", type: "trigger", title: "Start manually", description: "Manual start", settings: { event: "manual" } },
      { id: "append-1", type: "action", title: "Append lead", description: "Save the lead to the sheet", settings: {
        provider: "google_sheets", operation: "append_rows",
        spreadsheetId: "sheet-id", range: "Leads!A1",
        values: JSON.stringify([["Name", "Email"], ["Test User", "test@example.com"]])
      } }
    ]
  };
  const result = await generateWorkflow({
    prompt: "Append new leads to Google Sheets",
    nodeCatalog,
    env,
    fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(generated) } }] })
  });
  assert.equal(result.definition.nodes[1].settings.provider, "google_sheets");
  assert.equal(result.definition.nodes[1].settings.operation, "append_rows");
  assert.deepEqual(JSON.parse(result.definition.nodes[1].settings.values), [["Name", "Email"], ["Test User", "test@example.com"]]);
  assert.equal(result.saved, false);
  assert.equal(result.executed, false);
});

test("rejects registered node drafts with unsupported fields or invalid structured input", async () => {
  const nodeCatalog = [{
    id: "google_sheets", name: "Google Sheets", version: 1, auth: { type: "oauth2" }, triggers: [],
    actions: [{ id: "append_rows", name: "Append rows", description: "Append rows.", inputSchema: {
      type: "object", properties: { spreadsheetId: { type: "string" }, values: { type: "array" } },
      required: ["spreadsheetId", "values"]
    } }]
  }];
  const invalid = {
    version: 1,
    nodes: [
      { id: "trigger-1", type: "trigger", title: "Start", description: "", settings: { event: "manual" } },
      { id: "action-1", type: "action", title: "Append", description: "", settings: {
        provider: "google_sheets", operation: "append_rows", spreadsheetId: "sheet", values: "not-json", injected: "not-allowed"
      } }
    ]
  };
  await assert.rejects(generateWorkflow({
    prompt: "Append rows",
    nodeCatalog,
    env,
    fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(invalid) } }] })
  }), /AI_UNSAFE_WORKFLOW/);
});
