import { test } from "node:test";
import assert from "node:assert/strict";
import { nodes, findOperation } from "../nodes/registry";
import { executeRegisteredOperation } from "../nodes/runner";
import type { NodeContext } from "../nodes/types";

test("registry includes versioned provider and data utility operations", () => {
  assert.equal(nodes.length, 19);
  assert.ok(findOperation("manual", "start", "trigger"));
  assert.ok(findOperation("webhooks", "receive_event", "trigger"));
  assert.ok(findOperation("openai", "generate_text", "action"));
  assert.ok(findOperation("gemini", "generate_text", "action"));
  assert.ok(findOperation("slack", "send_message", "action"));
  assert.ok(findOperation("email", "send_email", "action"));
  assert.ok(findOperation("gmail", "list_messages", "action"));
  assert.ok(findOperation("google_sheets", "get_values", "action"));
  assert.ok(findOperation("slack", "post_message", "action"));
  assert.ok(findOperation("notion", "create_page", "action"));
  assert.ok(findOperation("hubspot", "create_contact", "action"));
  assert.ok(findOperation("twilio", "send_sms", "action"));
  assert.ok(findOperation("shopify", "list_products", "action"));
  assert.ok(findOperation("stripe", "create_customer", "action"));
  assert.ok(findOperation("linear", "create_issue", "action"));
  assert.ok(findOperation("set_fields", "merge_fields", "action"));
  assert.ok(findOperation("json_parse", "parse", "action"));
  assert.ok(findOperation("filter", "filter_items", "action"));
  assert.ok(findOperation("aggregate", "calculate", "action"));
  assert.ok(findOperation("date_time", "current_time", "action"));
});

test("manual trigger accepts the legacy builder's manual start event", async () => {
  const operation = findOperation("manual", "start", "trigger");
  assert.ok(operation);
  const result = await operation.run({
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  }, {});
  assert.deepEqual(result, { started: true });
});

test("webhook trigger refuses events not verified by ingress", async () => {
  const operation = findOperation("webhooks", "receive_event", "trigger");
  assert.ok(operation);
  await assert.rejects(() => operation.run({
    credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } },
    previousOutputs: {},
  }, { eventId: "evt_1", eventType: "signup", receivedAt: new Date().toISOString(), payload: { email: "a@example.com" } }), /WEBHOOK_SIGNATURE_NOT_VERIFIED/);
});

test("registry runner resolves an operation by node and operation IDs", async () => {
  const result = await executeRegisteredOperation({
    nodeId: "webhooks", operationId: "receive_event", kind: "trigger",
    context: { credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {}, webhook: { verified: true } },
    input: { eventId: "evt_1", eventType: "signup", receivedAt: new Date().toISOString(), payload: { email: "a@example.com" } },
  });
  assert.equal((result as { eventType: string }).eventType, "signup");
});

test("OpenAI action makes a real Responses API request and validates actual output", async () => {
  const operation = findOperation("openai", "generate_text", "action");
  assert.ok(operation);
  let requestedUrl = "";
  const result = await operation.run({
    credentials: { openai: { apiKey: "test-only-key" } },
    logger: { info() {}, error() {} },
    http: { async request(args) { requestedUrl = args.url; return { status: 200, body: { output_text: "Hello from provider", model: "gpt-4o-mini", usage: { input_tokens: 2, output_tokens: 4 } } }; } },
    previousOutputs: {},
  }, { prompt: "Say hello", model: "gpt-4o-mini", maxOutputTokens: 50 });
  assert.equal(requestedUrl, "https://api.openai.com/v1/responses");
  assert.equal((result as { text: string }).text, "Hello from provider");
  assert.equal((result as { outputTokens?: number }).outputTokens, 4);
});


test("Gemini action calls the configured workspace model and validates its response", async () => {
  const operation = findOperation("gemini", "generate_text", "action");
  assert.ok(operation);
  let requestedUrl = "";
  let requestHeaders: Record<string, string> | undefined;
  const result = await operation.run({
    credentials: { gemini: { apiKey: "test-only-key" } },
    logger: { info() {}, error() {} },
    http: { async request(args) {
      requestedUrl = args.url;
      requestHeaders = args.headers;
      return { status: 200, body: {
        candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5 },
      } };
    } },
    previousOutputs: {},
  }, { prompt: "Say hello", model: "gemini-2.5-flash", maxOutputTokens: 50 });
  assert.match(requestedUrl, /generativelanguage\.googleapis\.com/);
  assert.equal(requestHeaders?.["x-goog-api-key"], "test-only-key");
  assert.doesNotMatch(requestedUrl, /key=/);
  assert.equal((result as { text: string }).text, "Hello from Gemini");
  assert.equal((result as { outputTokens?: number }).outputTokens, 5);
});

test("Slack action restricts configured webhook hosts and sends the message", async () => {
  const operation = findOperation("slack", "send_message", "action");
  assert.ok(operation);
  let requestedUrl = "";
  const result = await operation.run({
    credentials: { slack: { webhookUrl: "https://hooks.slack.com/services/T000/B000/secret" } },
    logger: { info() {}, error() {} },
    http: { async request(args) { requestedUrl = args.url; return { status: 200, body: "ok" }; } },
    previousOutputs: {},
  }, { message: "Test message" });
  assert.equal(requestedUrl, "https://hooks.slack.com/services/T000/B000/secret");
  assert.equal((result as { accepted: boolean }).accepted, true);
  await assert.rejects(() => operation.run({
    credentials: { slack: { webhookUrl: "https://example.com/webhook" } },
    logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  }, { message: "Test message" }), /SLACK_CONNECTION_INVALID/);
});

test("Email action sends through Resend and returns provider message ID", async () => {
  const operation = findOperation("email", "send_email", "action");
  assert.ok(operation);
  let requestedUrl = "";
  const result = await operation.run({
    credentials: { resend: { apiKey: "test-only-key", fromEmail: "test@example.com" } },
    logger: { info() {}, error() {} },
    http: { async request(args) { requestedUrl = args.url; return { status: 200, body: { id: "email_test_123" } }; } },
    previousOutputs: {},
  }, { to: "recipient@example.com", subject: "Test", text: "Test message" });
  assert.equal(requestedUrl, "https://api.resend.com/emails");
  assert.equal((result as { messageId: string }).messageId, "email_test_123");
});

test("shared registry draft validator accepts only registered operations and schema-valid inputs", async () => {
  const { validateRegisteredSteps } = await import("../nodes/validate-steps");
  const valid = [
    { id: "start", nodeId: "manual", operationId: "start", kind: "trigger", input: {} },
    { id: "ai", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Qualify this lead" } },
  ];
  assert.equal(validateRegisteredSteps(valid).steps?.length, 2);
  assert.match(validateRegisteredSteps([{ ...valid[0] }, { ...valid[1], nodeId: "unregistered" }]).error ?? "", /Unknown registry operation/);
  assert.match(validateRegisteredSteps([{ ...valid[0] }, { ...valid[1], input: { prompt: "ok", secret: "not-allowed" } }]).error ?? "", /Invalid input/);
  assert.match(validateRegisteredSteps([valid[1]]).error ?? "", /exactly one trigger/);
});


test("ten vendor integrations execute through validated native registry operations", async () => {
  const calls: Array<{ url: string; method: string; headers?: Record<string, string>; body?: unknown }> = [];
  const context: NodeContext = {
    credentials: {
      gmail: { accessToken: "google-gmail-token" },
      sheets: { accessToken: "google-sheets-token" },
      slack: { botToken: "xoxb-test" },
      notion: { apiKey: "ntn_test" },
      hubspot: { accessToken: "hubspot-test" },
      twilio: { accountSid: "AC123", authToken: "twilio-test", fromPhone: "+15550001111" },
      shopify: { shopDomain: "example.myshopify.com", accessToken: "shopify-test" },
      stripe: { secretKey: "sk_test_123" },
      linear: { apiKey: "lin_api_test" },
    },
    logger: { info() {}, error() {} },
    http: { async request(args: { url: string; method: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }) {
      calls.push(args);
      if (args.url.includes("gmail.googleapis.com")) return { status: 200, body: { messages: [{ id: "m_1", threadId: "t_1" }], resultSizeEstimate: 1 } };
      if (args.url.includes("sheets.googleapis.com")) return { status: 200, body: { range: "Sheet1!A1:B2", values: [["a", "b"]] } };
      if (args.url.includes("slack.com/api/chat.postMessage")) return { status: 200, body: { ok: true, channel: "C123", ts: "123.456" } };
      if (args.url === "https://api.notion.com/v1/pages") return { status: 200, body: { id: "11111111-1111-4111-8111-111111111111", url: "https://notion.so/page" } };
      if (args.url.includes("api.hubapi.com")) return { status: 201, body: { id: "contact_1" } };
      if (args.url.includes("api.twilio.com")) return { status: 201, body: { sid: "SM123", status: "queued" } };
      if (args.url.includes("myshopify.com")) return { status: 200, body: { products: [{ id: 42, title: "Demo", status: "active" }] } };
      if (args.url === "https://api.stripe.com/v1/customers") return { status: 200, body: { id: "cus_123", email: "person@example.com" } };
      if (args.url === "https://api.linear.app/graphql") return { status: 200, body: { data: { issueCreate: { success: true, issue: { id: "issue_1", identifier: "AV-1", url: "https://linear.app/acme/issue/AV-1" } } } } };
      return { status: 500, body: {} };
    } },
    previousOutputs: {},
  };
  const cases = [
    ["gmail", "list_messages", { query: "is:unread", maxResults: 5 }],
    ["google_sheets", "get_values", { spreadsheetId: "abcdefghijklmnopqrstuvwx", range: "Sheet1!A1:B2" }],
    ["slack", "post_message", { channel: "C123", message: "Hello" }],
    ["notion", "create_page", { databaseId: "11111111-1111-4111-8111-111111111111", title: "New lead" }],
    ["hubspot", "create_contact", { email: "person@example.com", firstName: "Ada" }],
    ["twilio", "send_sms", { to: "+15550002222", body: "Hello" }],
    ["shopify", "list_products", { limit: 5 }],
    ["stripe", "create_customer", { email: "person@example.com", name: "Ada" }],
    ["linear", "create_issue", { teamId: "team_1", title: "Investigate lead sync" }],
  ] as const;
  for (const [nodeId, operationId, input] of cases) {
    await executeRegisteredOperation({ nodeId, operationId, kind: "action", context, input });
  }
  assert.equal(calls.length, 9);
  assert.ok(calls.some((call) => call.url.includes("gmail.googleapis.com")));
  assert.ok(calls.some((call) => call.url.includes("sheets.googleapis.com")));
  assert.ok(calls.some((call) => call.url === "https://api.notion.com/v1/pages"));
  assert.ok(calls.some((call) => call.url.includes("api.hubapi.com")));
  assert.ok(calls.some((call) => call.url.includes("api.twilio.com")));
  assert.ok(calls.some((call) => call.url.includes("myshopify.com")));
  assert.ok(calls.some((call) => call.url === "https://api.stripe.com/v1/customers"));
  assert.ok(calls.some((call) => call.url === "https://api.linear.app/graphql"));
});


test("dry-run simulates all ten vendor integrations without provider calls", async () => {
  let calls = 0;
  const steps = [
    { id: "gmail", nodeId: "gmail", operationId: "list_messages", kind: "action" as const, input: {} },
    { id: "sheets", nodeId: "google_sheets", operationId: "get_values", kind: "action" as const, input: { spreadsheetId: "abcdefghijklmnopqrstuvwx", range: "Sheet1!A1:B2" } },
    { id: "slack", nodeId: "slack", operationId: "post_message", kind: "action" as const, input: { channel: "C123", message: "Hello" } },
    { id: "notion", nodeId: "notion", operationId: "create_page", kind: "action" as const, input: { databaseId: "11111111-1111-4111-8111-111111111111", title: "Draft" } },
    { id: "hubspot", nodeId: "hubspot", operationId: "create_contact", kind: "action" as const, input: { email: "person@example.com" } },
    { id: "twilio", nodeId: "twilio", operationId: "send_sms", kind: "action" as const, input: { to: "+15550002222", body: "Draft" } },
    { id: "shopify", nodeId: "shopify", operationId: "list_products", kind: "action" as const, input: {} },
    { id: "stripe", nodeId: "stripe", operationId: "create_customer", kind: "action" as const, input: { email: "person@example.com" } },
    { id: "linear", nodeId: "linear", operationId: "create_issue", kind: "action" as const, input: { teamId: "team_1", title: "Draft issue" } },
    { id: "resend", nodeId: "email", operationId: "send_email", kind: "action" as const, input: { to: "person@example.com", subject: "Draft", text: "Draft only" } },
  ];
  const { executeRegisteredWorkflow } = await import("../nodes/workflow-runner");
  const result = await executeRegisteredWorkflow({
    steps,
    context: {
      credentials: {},
      logger: { info() {}, error() {} },
      http: { async request() { calls++; return { status: 200, body: {} }; } },
    },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps.length, 10);
  assert.ok(result.steps.every((step) => step.status === "simulated"));
  assert.equal(calls, 0);
});
