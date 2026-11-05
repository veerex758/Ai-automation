import { test } from "node:test";
import assert from "node:assert/strict";
import { nodes, findOperation } from "../nodes/registry";
import { executeRegisteredOperation } from "../nodes/runner";

test("registry includes versioned webhook, Gemini, Slack and Email operations", () => {
  assert.equal(nodes.length, 5);
  assert.ok(findOperation("manual", "start", "trigger"));
  assert.ok(findOperation("webhooks", "receive_event", "trigger"));
  assert.ok(findOperation("gemini", "generate_text", "action"));
  assert.ok(findOperation("slack", "send_message", "action"));
  assert.ok(findOperation("email", "send_email", "action"));
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

test("Gemini action makes a real Gemini API request and validates actual output", async () => {
  const operation = findOperation("gemini", "generate_text", "action");
  assert.ok(operation);
  let requestedUrl = "";
  const result = await operation.run({
    credentials: { gemini: { apiKey: "test-only-key" } },
    logger: { info() {}, error() {} },
    http: { async request(args) { requestedUrl = args.url; return { status: 200, body: { candidates: [{ content: { parts: [{ text: "Hello from provider" }] } }], modelVersion: "gemini-2.5-flash", usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4 } } }; } },
    previousOutputs: {},
  }, { prompt: "Say hello", model: "gemini-2.5-flash", maxOutputTokens: 50 });
  assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal((result as { text: string }).text, "Hello from provider");
  assert.equal((result as { outputTokens?: number }).outputTokens, 4);
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

test("Gemini qualifies a real-estate enquiry with structured output and token usage", async () => {
  const operation = findOperation("gemini", "qualify_real_estate_lead", "action");
  assert.ok(operation);
  let sentBody: unknown;
  const qualification = {
    fullName: "Ada Buyer", email: "ada@example.com", phone: null,
    propertyType: "apartment", location: "Lekki", budget: "₦80m",
    timeframe: "within_30_days", temperature: "hot",
    reason: "Specific property type, location, budget and near-term timeline.",
    missingInformation: ["Phone number"],
    suggestedReply: "Thanks for your enquiry. May we have your phone number?",
    summary: "HOT lead: Ada Buyer wants an apartment in Lekki within 30 days; budget ₦80m. Phone number missing.",
  };
  const result = await operation.run({
    credentials: { gemini: { apiKey: "test-only-key" } },
    logger: { info() {}, error() {} },
    http: { async request(args) {
      sentBody = args.body;
      return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(qualification) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 80 } } };
    } },
    previousOutputs: {},
  }, { leadData: "Ada wants an apartment in Lekki, budget ₦80m, needs it within 30 days." });
  assert.equal((result as { temperature: string }).temperature, "hot");
  assert.equal((result as { email: string }).email, "ada@example.com");
  assert.equal((result as { inputTokens: number }).inputTokens, 100);
  assert.ok((sentBody as { generationConfig: { responseJsonSchema: unknown } }).generationConfig.responseJsonSchema);
});
