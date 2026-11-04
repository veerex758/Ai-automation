import { test } from "node:test";
import assert from "node:assert/strict";
import { nodes, findOperation, getPublicNodeCatalog } from "../nodes/registry";
import { executeRegisteredOperation } from "../nodes/runner";

test("registry includes the original nodes and ten additional registered nodes", () => {
  assert.equal(nodes.length, 71);
  assert.ok(findOperation("manual", "start", "trigger"));
  assert.ok(findOperation("webhooks", "receive_event", "trigger"));
  assert.ok(findOperation("openai", "generate_text", "action"));
  assert.ok(findOperation("slack", "send_message", "action"));
  assert.ok(findOperation("email", "send_email", "action"));
  for (const id of ["google_sheets", "gmail", "notion", "discord", "telegram", "airtable", "hubspot", "trello", "json", "date_time", "error_trigger", "sub_workflow", "rate_limiter", "deduplicate", "sort", "split_batches", "crypto_hash", "template", "csv", "excel", "pdf_generate", "pdf_extract", "xml", "markdown_html", "image_resize", "cohere", "together_ai", "replicate", "deepl", "assemblyai", "openai_whisper", "weaviate", "messagebird", "vonage_sms", "brevo", "convertkit", "klaviyo", "lemlist", "customer_io", "mixpanel", "posthog", "segment", "datadog", "google_analytics", "tally", "signal", "matrix", "mattermost", "beehiiv", "activecampaign", "bigcommerce", "gumroad", "wise", "coinbase", "plaid", "algolia", "cloudflare", "neon", "planetscale", "elasticsearch", "docker_ssh", "coda", "confluence", "obsidian", "evernote", "basecamp"]) {
    assert.ok(nodes.some((node) => node.id === id), "missing node: " + id);
    if (id !== "error_trigger") assert.ok(nodes.find((node) => node.id === id)!.actions.length > 0, "missing action: " + id);
  }
  assert.ok(findOperation("error_trigger", "catch_error", "trigger"));
  assert.ok(findOperation("google_sheets", "append_rows", "action"));
  assert.ok(findOperation("gmail", "send_email", "action"));
  assert.ok(findOperation("notion", "create_page", "action"));
  assert.ok(findOperation("discord", "send_message", "action"));
  assert.ok(findOperation("telegram", "send_message", "action"));
  assert.ok(findOperation("airtable", "create_record", "action"));
  assert.ok(findOperation("hubspot", "create_contact", "action"));
  assert.ok(findOperation("trello", "create_card", "action"));
  assert.ok(findOperation("json", "parse", "action"));
  assert.ok(findOperation("date_time", "current_time", "action"));
  assert.ok(findOperation("messagebird", "send_sms", "action"));
  assert.ok(findOperation("vonage_sms", "send_sms", "action"));
  assert.ok(findOperation("brevo", "send_transactional_email", "action"));
  assert.ok(findOperation("convertkit", "add_subscriber_to_form", "action"));
  assert.ok(findOperation("klaviyo", "create_profile", "action"));
  assert.ok(findOperation("lemlist", "create_lead", "action"));
  assert.ok(findOperation("customer_io", "identify_customer", "action"));
  assert.ok(findOperation("mixpanel", "track_event", "action"));
  assert.ok(findOperation("posthog", "capture_event", "action"));
  assert.ok(findOperation("segment", "track_event", "action"));
  assert.ok(findOperation("datadog", "submit_log", "action"));
  assert.ok(findOperation("google_analytics", "send_event", "action"));
  assert.ok(findOperation("tally", "get_form", "action"));
  assert.ok(findOperation("signal", "send_message", "action"));
  assert.ok(findOperation("matrix", "send_room_message", "action"));
  assert.ok(findOperation("mattermost", "create_post", "action"));
  assert.ok(findOperation("beehiiv", "create_subscription", "action"));
  assert.ok(findOperation("activecampaign", "sync_contact", "action"));
  assert.ok(findOperation("bigcommerce", "create_product", "action"));
  assert.ok(findOperation("gumroad", "verify_sale", "action"));
  assert.ok(findOperation("wise", "list_profiles", "action"));
  assert.ok(findOperation("coinbase", "list_accounts", "action"));
  assert.ok(findOperation("plaid", "get_accounts", "action"));
  assert.ok(findOperation("algolia", "search_index", "action"));
  assert.ok(findOperation("cloudflare", "list_zones", "action"));
  assert.ok(findOperation("neon", "list_projects", "action"));
  assert.ok(findOperation("planetscale", "list_databases", "action"));
  assert.ok(findOperation("elasticsearch", "search", "action"));
  assert.ok(findOperation("docker_ssh", "execute_command", "action"));
  assert.ok(findOperation("coda", "list_docs", "action"));
  assert.ok(findOperation("confluence", "search_pages", "action"));
  assert.ok(findOperation("obsidian", "read_note", "action"));
  assert.ok(findOperation("evernote", "search_notes", "action"));
  assert.ok(findOperation("basecamp", "list_projects", "action"));
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


test("JSON tools parse structured data and safely select a property path", async () => {
  const operation = findOperation("json", "parse", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {} }, { json: JSON.stringify({ contact: { email: "person@example.com" } }), path: ["contact", "email"] });
  assert.equal((result as { value: string }).value, "person@example.com");
  await assert.rejects(() => operation.run({ credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {} }, { json: "{bad" }), /JSON_INVALID_INPUT/);
});

test("Date & Time node returns a valid timezone-aware formatted result", async () => {
  const operation = findOperation("date_time", "current_time", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {} }, { timezone: "Africa/Lagos" }) as { iso: string; local: string; timezone: string };
  assert.equal(new Date(result.iso).toISOString(), result.iso);
  assert.equal(result.timezone, "Africa/Lagos");
  assert.ok(result.local.length > 0);
  await assert.rejects(() => operation.run({ credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {} }, { timezone: "Not/AZone" }), /DATE_TIME_INVALID_TIMEZONE/);
});

test("Google Sheets action appends rows using the connected Google token", async () => {
  const operation = findOperation("google_sheets", "append_rows", "action");
  assert.ok(operation);
  let requestUrl = "";
  const result = await operation.run({ credentials: { google_sheets: { accessToken: "test-token" } }, logger: { info() {}, error() {} }, http: { async request(args) { requestUrl = args.url; return { status: 200, body: { updates: { updatedRange: "Sheet1!A1:B2", updatedRows: 2 } } }; } }, previousOutputs: {} }, { spreadsheetId: "sheet123", range: "Sheet1!A1", values: [["a", "b"], ["c", "d"]] }) as { updatedRows: number };
  assert.match(requestUrl, /sheets.googleapis.com/);
  assert.equal(result.updatedRows, 2);
});

test("Gmail action sends through the authenticated Gmail API", async () => {
  const operation = findOperation("gmail", "send_email", "action");
  assert.ok(operation);
  let requestBody: unknown;
  const result = await operation.run({ credentials: { gmail: { accessToken: "test-token" } }, logger: { info() {}, error() {} }, http: { async request(args) { requestBody = args.body; return { status: 200, body: { id: "gmail_msg_1", threadId: "thread_1" } }; } }, previousOutputs: {} }, { to: "person@example.com", subject: "Hello", body: "Test" }) as { messageId: string };
  assert.equal(result.messageId, "gmail_msg_1");
  assert.equal(typeof (requestBody as { raw: string }).raw, "string");
});

test("Notion action creates a page and returns its provider URL", async () => {
  const operation = findOperation("notion", "create_page", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { notion: { apiKey: "test-token" } }, logger: { info() {}, error() {} }, http: { async request() { return { status: 200, body: { id: "00000000-0000-4000-8000-000000000001", url: "https://www.notion.so/example" } }; } }, previousOutputs: {} }, { parentId: "00000000-0000-4000-8000-000000000002", title: "New page" }) as { pageId: string };
  assert.equal(result.pageId, "00000000-0000-4000-8000-000000000001");
});

test("Discord and Telegram actions send messages through their bot APIs", async () => {
  const discord = findOperation("discord", "send_message", "action");
  const telegram = findOperation("telegram", "send_message", "action");
  assert.ok(discord && telegram);
  let calls = 0;
  const http = { async request(args: { url: string }) { calls++; return args.url.includes("discord.com") ? { status: 200, body: { id: "discord_msg", channel_id: "123456" } } : { status: 200, body: { ok: true, result: { message_id: 42, chat: { id: 123 } } } }; } };
  const base = { logger: { info() {}, error() {} }, http, previousOutputs: {} };
  const d = await discord.run({ ...base, credentials: { discord: { botToken: "test" } } }, { channelId: "123456", message: "hello" }) as { messageId: string };
  const t = await telegram.run({ ...base, credentials: { telegram: { botToken: "test" } } }, { chatId: "123", message: "hello" }) as { messageId: number };
  assert.equal(d.messageId, "discord_msg");
  assert.equal(t.messageId, 42);
  assert.equal(calls, 2);
});

test("Airtable, HubSpot and Trello actions create records, contacts and cards", async () => {
  const airtable = findOperation("airtable", "create_record", "action");
  const hubspot = findOperation("hubspot", "create_contact", "action");
  const trello = findOperation("trello", "create_card", "action");
  assert.ok(airtable && hubspot && trello);
  const http = { async request(args: { url: string }) {
    if (args.url.includes("airtable.com")) return { status: 200, body: { id: "rec_1", createdTime: "2026-11-04T00:00:00.000Z" } };
    if (args.url.includes("hubapi.com")) return { status: 200, body: { id: "contact_1" } };
    return { status: 200, body: { id: "card_1", url: "https://trello.com/c/card_1" } };
  } };
  const base = { logger: { info() {}, error() {} }, http, previousOutputs: {} };
  const a = await airtable.run({ ...base, credentials: { airtable: { accessToken: "test" } } }, { baseId: "app123", tableName: "Contacts", fields: { Name: "Test" } }) as { recordId: string };
  const h = await hubspot.run({ ...base, credentials: { hubspot: { accessToken: "test" } } }, { email: "person@example.com" }) as { contactId: string };
  const t = await trello.run({ ...base, credentials: { trello: { apiKey: "key", token: "token" } } }, { listId: "list123", name: "New task" }) as { cardId: string };
  assert.equal(a.recordId, "rec_1");
  assert.equal(h.contactId, "contact_1");
  assert.equal(t.cardId, "card_1");
});


test("public node catalog exposes all ten new operations and JSON schemas to the authenticated builder API", () => {
  const catalog = getPublicNodeCatalog();
  assert.equal(catalog.length, 15);
  const expected = [
    ["google_sheets", "append_rows"],
    ["gmail", "send_email"],
    ["notion", "create_page"],
    ["discord", "send_message"],
    ["telegram", "send_message"],
    ["airtable", "create_record"],
    ["hubspot", "create_contact"],
    ["trello", "create_card"],
    ["json", "parse"],
    ["date_time", "current_time"],
  ];
  for (const [nodeId, operationId] of expected) {
    const node = catalog.find((item) => item.id === nodeId);
    assert.ok(node, "catalog missing " + nodeId);
    const operation = node.actions.find((item) => item.id === operationId);
    assert.ok(operation, "catalog missing operation " + nodeId + "." + operationId);
    assert.ok(operation.inputSchema && typeof operation.inputSchema === "object");
    assert.ok(operation.outputSchema && typeof operation.outputSchema === "object");
  }
});
