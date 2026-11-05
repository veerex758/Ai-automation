/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { providerPack } from "../nodes/provider-pack";
import { findOperation } from "../nodes/registry";

test("20 additional catalogue providers have executable schema-backed actions", () => {
  assert.equal(providerPack.length, 20);
  for (const node of providerPack) {
    assert.equal(node.actions.length, 1, node.id);
    const action = node.actions[0];
    assert.ok(action.id);
    assert.ok(action.inputSchema);
    assert.ok(action.outputSchema);
    assert.equal(typeof action.run, "function");
  }
});

test("provider adapters fail closed when workspace credentials are absent", async () => {
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("network must not be reached"); } },
    previousOutputs: {},
  };
  const node = findOperation("claude", "execute", "action");
  assert.ok(node);
  await assert.rejects(() => node.run(context, { prompt: "hello" }), /CLAUDE_CONNECTION_REQUIRED/);
});

test("Claude adapter uses fixed vendor endpoint and validates returned text", async () => {
  let called: any;
  const context = {
    credentials: { claude: { apiKey: "test-token" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) {
      called = args;
      return { status: 200, body: { model: "claude-test", content: [{ type: "text", text: "Hello from Claude" }] } };
    } },
    previousOutputs: {},
  };
  const operation = findOperation("claude", "execute", "action");
  assert.ok(operation);
  const result = await operation.run(context, { prompt: "hello" });
  assert.deepEqual(result, { text: "Hello from Claude", model: "claude-test" });
  assert.equal(called.url, "https://api.anthropic.com/v1/messages");
  assert.equal(called.headers["x-api-key"], "test-token");
});

test("RSS node is credential-free and still relies on the guarded HTTP client", async () => {
  let called = false;
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request(args: any) {
      called = true;
      assert.equal(args.method, "GET");
      return { status: 200, body: "<rss><channel/></rss>" };
    } },
    previousOutputs: {},
  };
  const operation = findOperation("rss_feed", "execute", "action");
  assert.ok(operation);
  const result = await operation.run(context, { feedUrl: "https://feeds.example.test/rss" });
  assert.equal((result as any).xml, "<rss><channel/></rss>");
  assert.equal(called, true);
});


test("Sentry adapter accepts the provider's top-level projects array", async () => {
  let requested = "";
  const context = {
    credentials: { sentry: { authToken: "sentry-test-token" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) {
      requested = args.url;
      return { status: 200, body: [{ id: "42", name: "Aivanta", slug: "aivanta" }] };
    } },
    previousOutputs: {},
  };
  const operation = findOperation("sentry", "execute", "action");
  assert.ok(operation);
  const result = await operation.run(context, { organization: "acme" });
  assert.match(requested, /organizations\/acme\/projects/);
  assert.deepEqual(result, { projects: [{ id: "42", name: "Aivanta", slug: "aivanta" }] });
});

test("provider auth metadata names the actual saved secret and RSS needs no credential", () => {
  const byId = new Map(providerPack.map((node) => [node.id, node]));
  assert.equal(byId.get("discord")?.auth.type, "apiKey");
  assert.equal((byId.get("discord")?.auth as any).credentialKey, "botToken");
  assert.equal((byId.get("whatsapp_business")?.auth as any).credentialKey, "accessToken");
  assert.equal(byId.get("rss_feed")?.auth.type, "none");
});


test("four catalogue AI providers are registered with schema-backed actions", () => {
  const ids = ["elevenlabs", "stability_ai", "hugging_face", "pinecone"];
  for (const id of ids) {
    const operation = findOperation(id, "execute", "action");
    assert.ok(operation, id);
    assert.ok(operation.inputSchema.toJSONSchema());
    assert.ok(operation.outputSchema.toJSONSchema());
  }
});

test("ElevenLabs lists bounded voice metadata using the saved API key", async () => {
  let request: any;
  const operation = findOperation("elevenlabs", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { elevenlabs: { apiKey: "eleven-test" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) { request = args; return { status: 200, body: { voices: [{ voice_id: "voice-1", name: "Test Voice", category: "premade" }] } }; } },
    previousOutputs: {},
  }, { pageSize: 10 });
  assert.deepEqual(result, { voices: [{ voiceId: "voice-1", name: "Test Voice", category: "premade" }] });
  assert.equal(request.headers["xi-api-key"], "eleven-test");
});

test("Stability AI accepts the provider's engine-list array response", async () => {
  const operation = findOperation("stability_ai", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { stability_ai: { apiKey: "stability-test" } },
    logger: { info() {}, error() {} },
    http: { async request() { return { status: 200, body: [{ id: "stable-image-core", name: "Stable Image Core", type: "PICTURE" }] }; } },
    previousOutputs: {},
  }, {});
  assert.deepEqual(result, { models: [{ id: "stable-image-core", name: "Stable Image Core", type: "PICTURE" }] });
});

test("Hugging Face validates model identifiers and extracts generated text", async () => {
  const operation = findOperation("hugging_face", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { hugging_face: { apiKey: "hf-test" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) {
      assert.match(args.url, /models\/org\/model/);
      assert.equal(args.headers.Authorization, "Bearer hf-test");
      return { status: 200, body: [{ generated_text: "Generated safely" }] };
    } },
    previousOutputs: {},
  }, { model: "org/model", inputs: "Write a greeting", maxNewTokens: 32 });
  assert.deepEqual(result, { generatedText: "Generated safely" });
});

test("Pinecone requires a Pinecone HTTPS index host and returns validated matches", async () => {
  const operation = findOperation("pinecone", "execute", "action");
  assert.ok(operation);
  const context = {
    credentials: { pinecone: { apiKey: "pc-test", indexHost: "https://aivanta-test.svc.us-east1-gcp.pinecone.io" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) {
      assert.equal(args.url, "https://aivanta-test.svc.us-east1-gcp.pinecone.io/query");
      return { status: 200, body: { matches: [{ id: "vector-1", score: 0.98, metadata: { kind: "lead" } }] } };
    } },
    previousOutputs: {},
  };
  const result = await operation.run(context, { vector: [0.1, 0.2], topK: 5 });
  assert.deepEqual(result, { matches: [{ id: "vector-1", score: 0.98, metadata: { kind: "lead" } }] });
  await assert.rejects(() => operation.run({ ...context, credentials: { pinecone: { apiKey: "pc-test", indexHost: "https://example.com" } } }, { vector: [1] }), /PINECONE_CONNECTION_INVALID/);
});


test("Microsoft Teams sends a bounded message to the selected chat", async () => {
  const operation = findOperation("microsoft_teams", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { microsoft_teams: { accessToken: "teams-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /chats\/chat-1\/messages$/); assert.equal(args.headers.Authorization, "Bearer teams-token"); return { status: 201, body: { id: "message-1" } }; } }, previousOutputs: {} },
    { chatId: "chat-1", content: "Hello team" });
  assert.deepEqual(result, { messageId: "message-1", chatId: "chat-1" });
});

test("Salesforce validates its instance host and creates a lead", async () => {
  const operation = findOperation("salesforce", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { salesforce: { accessToken: "sf-token", instanceUrl: "https://acme.my.salesforce.com" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /sobjects\/Lead/); return { status: 201, body: { id: "00Q123", success: true } }; } }, previousOutputs: {} },
    { firstName: "Ada", lastName: "Lovelace", company: "Aivanta", email: "ada@example.test" });
  assert.deepEqual(result, { leadId: "00Q123", success: true });
});

test("Pipedrive creates a person and normalizes the returned identifier", async () => {
  const operation = findOperation("pipedrive", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { pipedrive: { accessToken: "pd-token" } }, logger: { info() {}, error() {} },
    http: { async request() { return { status: 201, body: { success: true, data: { id: 123 } } }; } }, previousOutputs: {} },
    { email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(result, { contactId: "123" });
});

test("Zoho CRM creates a contact from the provider's success details payload", async () => {
  const operation = findOperation("zoho_crm", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { zoho_crm: { accessToken: "zoho-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Zoho-oauthtoken zoho-token"); return { status: 201, body: { data: [{ status: "success", details: { id: "zoho-1" } }] } }; } }, previousOutputs: {} },
    { email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(result, { contactId: "zoho-1" });
});

test("Freshsales validates its account domain and creates a contact", async () => {
  const operation = findOperation("freshsales", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { freshsales: { accessToken: "fresh-token", domain: "acme.myfreshworks.com" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /^https:\/\/acme\.myfreshworks\.com\//); return { status: 201, body: { contact: { id: 456 } } }; } }, previousOutputs: {} },
    { email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(result, { contactId: "456" });
});

test("Close creates a lead using Basic API-key authentication", async () => {
  const operation = findOperation("close", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { close: { apiKey: "close-key" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Basic " + Buffer.from("close-key:").toString("base64")); return { status: 200, body: { id: "lead-1" } }; } }, previousOutputs: {} },
    { name: "Ada Lovelace", email: "ada@example.test" });
  assert.deepEqual(result, { contactId: "lead-1" });
});

test("Apollo creates a contact with the API key in its dedicated header", async () => {
  const operation = findOperation("apollo", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { apollo: { apiKey: "apollo-key" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers["x-api-key"], "apollo-key"); return { status: 200, body: { contact: { id: "apollo-1" } } }; } }, previousOutputs: {} },
    { email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(result, { contactId: "apollo-1" });
});

test("Intercom creates a contact and returns the provider ID", async () => {
  const operation = findOperation("intercom", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { intercom: { accessToken: "intercom-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers["Intercom-Version"], "2.11"); return { status: 200, body: { id: "intercom-1" } }; } }, previousOutputs: {} },
    { email: "ada@example.test", name: "Ada Lovelace" });
  assert.deepEqual(result, { contactId: "intercom-1" });
});


test("Google Drive lists bounded file metadata using its dedicated read-only token", async () => {
  const operation = findOperation("google_drive", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { google_drive: { accessToken: "drive-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /drive\/v3\/files/); assert.equal(args.headers.Authorization, "Bearer drive-token"); return { status: 200, body: { files: [{ id: "file-1", name: "Brief", mimeType: "text/plain" }] } }; } }, previousOutputs: {} }, { pageSize: 10 });
  assert.deepEqual(result, { files: [{ id: "file-1", name: "Brief", mimeType: "text/plain" }] });
});

test("Google Calendar lists events without granting write scopes", async () => {
  const operation = findOperation("google_calendar", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { google_calendar: { accessToken: "calendar-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /calendar\/v3\/calendars\/primary\/events/); return { status: 200, body: { items: [{ id: "event-1", summary: "Review", start: { dateTime: "2026-11-05T10:00:00Z" } }] } }; } }, previousOutputs: {} }, { maxResults: 5 });
  assert.deepEqual(result, { events: [{ id: "event-1", summary: "Review", start: { dateTime: "2026-11-05T10:00:00Z" } }] });
});

test("Google Docs reads document metadata only", async () => {
  const operation = findOperation("google_docs", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { google_docs: { accessToken: "docs-token" } }, logger: { info() {}, error() {} },
    http: { async request() { return { status: 200, body: { documentId: "document-123456", title: "Aivanta Plan", revisionId: "rev-1", body: { content: [{}, {}] } } }; } }, previousOutputs: {} }, { documentId: "document-123456" });
  assert.deepEqual(result, { documentId: "document-123456", title: "Aivanta Plan", revisionId: "rev-1", bodyElementCount: 2 });
});

test("Google Forms reads form title and question count", async () => {
  const operation = findOperation("google_forms", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { google_forms: { accessToken: "forms-token" } }, logger: { info() {}, error() {} },
    http: { async request() { return { status: 200, body: { formId: "form-123456789", info: { title: "Lead form" }, items: [{}, {}] } }; } }, previousOutputs: {} }, { formId: "form-123456789" });
  assert.deepEqual(result, { formId: "form-123456789", title: "Lead form", questionCount: 2 });
});

test("YouTube searches bounded video metadata", async () => {
  const operation = findOperation("youtube", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { youtube: { accessToken: "youtube-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /youtube\/v3\/search/); return { status: 200, body: { items: [{ id: { videoId: "video-1" }, snippet: { title: "Workflow design", channelTitle: "Aivanta" } }] } }; } }, previousOutputs: {} }, { query: "workflow", maxResults: 5 });
  assert.deepEqual(result, { videos: [{ videoId: "video-1", title: "Workflow design", channelTitle: "Aivanta" }] });
});

test("Google Contacts lists bounded people metadata", async () => {
  const operation = findOperation("google_contacts", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({ credentials: { google_contacts: { accessToken: "contacts-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /people\/v1\/people\/me\/connections/); return { status: 200, body: { connections: [{ resourceName: "people/1", names: [{ displayName: "Ada Lovelace" }], emailAddresses: [{ value: "ada@example.test" }] }] } }; } }, previousOutputs: {} }, { pageSize: 10 });
  assert.deepEqual(result, { people: [{ resourceName: "people/1", displayName: "Ada Lovelace", email: "ada@example.test" }] });
});
