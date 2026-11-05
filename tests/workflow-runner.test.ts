import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRegisteredWorkflow } from "../nodes/workflow-runner";

const context = {
  credentials: { gemini: { apiKey: "test-only-key" } },
  logger: { info() {}, error() {} },
  http: { async request() { return { status: 200, body: { candidates: [{ content: { parts: [{ text: "Generated text" }] } }], modelVersion: "gemini-2.5-flash" } }; } },
};

test("registry workflow dry-run validates registered steps without calling providers", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: {} }; } } },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps[0].status, "simulated");
  assert.equal(calls, 0);
});

test("registry workflow stores validated operation outputs for later steps", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps[0].status, "succeeded");
  assert.equal((result.outputs.draft as { text: string }).text, "Generated text");
});

test("registry workflow stops after a failed registered operation", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "bad", nodeId: "unknown", operationId: "missing", kind: "action", input: {} },
      { id: "later", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Should not run" } },
    ],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].error, "NODE_OPERATION_NOT_FOUND");
  assert.equal(result.steps[1].status, "skipped");
});

test("registry workflow dry-run accepts previous-step references without provider calls", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "draft", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } },
      { id: "rewrite", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Rewrite this: {{draft.text}}" } },
    ],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: {} }; } } },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].status, "simulated");
  assert.equal(calls, 0);
});

test("OpenAI output can feed Slack and Email in one registry workflow", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "draft", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Write a concise appointment reminder" } },
      { id: "slackNotice", nodeId: "slack", operationId: "send_message", kind: "action", input: { message: "Reminder draft: {{draft.text}}" } },
      { id: "emailNotice", nodeId: "email", operationId: "send_email", kind: "action", input: { to: "recipient@example.com", subject: "Appointment reminder", text: "{{draft.text}}" } },
    ],
    context: {
      credentials: {
        gemini: { apiKey: "test-only-key" },
        slack: { webhookUrl: "https://hooks.slack.com/services/T000/B000/secret" },
        resend: { apiKey: "test-only-key", fromEmail: "test@example.com" },
      },
      logger: { info() {}, error() {} },
      http: { async request(args) {
        requests.push({ url: args.url, body: args.body });
        if (args.url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent") return { status: 200, body: { candidates: [{ content: { parts: [{ text: "Your appointment is tomorrow at 10 AM." }] } }], modelVersion: "gemini-2.5-flash", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 } } };
        if (args.url === "https://api.resend.com/emails") return { status: 200, body: { id: "email_test_123" } };
        return { status: 200, body: "ok" };
      } },
    },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "succeeded"]);
  assert.equal(requests.length, 3);
  assert.equal((requests[1].body as { text: string }).text, "Reminder draft: Your appointment is tomorrow at 10 AM.");
  assert.equal((requests[2].body as { text: string }).text, "Your appointment is tomorrow at 10 AM.");
});

test("registry dry-run simulates Slack and Email without calling their providers", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "slackNotice", nodeId: "slack", operationId: "send_message", kind: "action", input: { message: "Hello" } },
      { id: "emailNotice", nodeId: "email", operationId: "send_email", kind: "action", input: { to: "recipient@example.com", subject: "Hello", text: "Hello" } },
    ],
    context: {
      credentials: { slack: { webhookUrl: "https://hooks.slack.com/services/T000/B000/secret" }, resend: { apiKey: "test-only-key", fromEmail: "test@example.com" } },
      logger: { info() {}, error() {} },
      http: { async request() { calls++; return { status: 200, body: {} }; } },
    },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["simulated", "simulated"]);
  assert.equal(calls, 0);
});

test("real-estate enquiry flows from verified webhook through Gemini to Resend", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const lead = {
    fullName: "Ada Buyer", email: "ada@example.com", phone: null, propertyType: "apartment",
    location: "Lekki", budget: "₦80m", timeframe: "within_30_days", temperature: "hot",
    reason: "Specific property and near-term intent.", missingInformation: ["Phone number"],
    suggestedReply: "Thanks for your enquiry. May we have your phone number?",
    summary: "HOT lead: Ada Buyer wants an apartment in Lekki within 30 days; budget ₦80m.",
  };
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "incoming", nodeId: "webhooks", operationId: "receive_event", kind: "trigger", input: {
        eventId: "evt_001", eventType: "lead.enquiry", receivedAt: new Date().toISOString(),
        payload: { name: "Ada Buyer", property: "apartment", location: "Lekki", budget: "₦80m", timeframe: "within 30 days" },
      } },
      { id: "qualify", nodeId: "gemini", operationId: "qualify_real_estate_lead", kind: "action", input: { leadData: "{{incoming.payload}}" } },
      { id: "notify", nodeId: "email", operationId: "send_email", kind: "action", input: {
        to: "agent@example.com", subject: "New {{qualify.temperature}} real-estate lead", text: "{{qualify.summary}}",
      } },
    ],
    context: {
      credentials: { gemini: { apiKey: "test-only-key" }, resend: { apiKey: "test-only-key", fromEmail: "verified@example.com" } },
      logger: { info() {}, error() {} },
      webhook: { verified: true },
      http: { async request(args) {
        requests.push({ url: args.url, body: args.body });
        if (args.url.includes("generativelanguage.googleapis.com")) {
          const sent = args.body as { contents: Array<{ parts: Array<{ text: string }> }> };
          assert.ok(sent.contents[0].parts[0].text.includes("Ada Buyer"));
          return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(lead) }] } }], usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 55 } } };
        }
        return { status: 200, body: { id: "resend_lead_001" } };
      } },
    },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "succeeded"]);
  assert.equal(requests.length, 2);
  assert.equal((requests[1].body as { text: string }).text, lead.summary);
  assert.equal((result.outputs.qualify as { outputTokens: number }).outputTokens, 55);
  assert.equal((result.outputs.notify as { messageId: string }).messageId, "resend_lead_001");
});
