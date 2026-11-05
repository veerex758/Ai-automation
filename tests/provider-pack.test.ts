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


test("Jira validates the Atlassian site and creates a project issue", async () => {
  const operation = findOperation("jira", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { jira: { siteUrl: "https://acme.atlassian.net", email: "admin@example.test", apiToken: "jira-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /rest\/api\/3\/issue$/); return { status: 201, body: { id: "10001", key: "AV-1" } }; } }, previousOutputs: {} },
    { projectKey: "AV", summary: "Review workflow" });
  assert.deepEqual(result, { issueId: "10001", issueKey: "AV-1", url: "https://acme.atlassian.net/browse/AV-1" });
});

test("Asana creates a task in the selected project", async () => {
  const operation = findOperation("asana", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { asana: { accessToken: "asana-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer asana-token"); return { status: 201, body: { data: { gid: "12001", name: "Prepare launch" } } }; } }, previousOutputs: {} },
    { projectGid: "123456789", name: "Prepare launch" });
  assert.deepEqual(result, { taskGid: "12001", name: "Prepare launch" });
});

test("Trello creates a card using the saved API key and token", async () => {
  const operation = findOperation("trello", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { trello: { apiKey: "trello-key", token: "trello-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { const url = new URL(args.url); assert.equal(url.searchParams.get("key"), "trello-key"); assert.equal(url.searchParams.get("token"), "trello-token"); return { status: 200, body: { id: "card-1", url: "https://trello.com/c/card-1" } }; } }, previousOutputs: {} },
    { listId: "list-1", name: "Review node batch" });
  assert.deepEqual(result, { cardId: "card-1", url: "https://trello.com/c/card-1" });
});

test("ClickUp creates a task in the selected list", async () => {
  const operation = findOperation("clickup", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { clickup: { token: "clickup-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "clickup-token"); return { status: 200, body: { id: "task-1", url: "https://app.clickup.com/t/task-1" } }; } }, previousOutputs: {} },
    { listId: "list-1", name: "Implement nodes" });
  assert.deepEqual(result, { taskId: "task-1", url: "https://app.clickup.com/t/task-1" });
});

test("Monday.com creates a board item using GraphQL", async () => {
  const operation = findOperation("monday", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { monday: { apiToken: "monday-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "monday-token"); return { status: 200, body: { data: { create_item: { id: "item-1", name: "Ship feature" } } } }; } }, previousOutputs: {} },
    { boardId: "123456", groupId: "topics", name: "Ship feature" });
  assert.deepEqual(result, { itemId: "item-1", name: "Ship feature" });
});

test("Todoist creates a task and returns its ID", async () => {
  const operation = findOperation("todoist", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { todoist: { accessToken: "todoist-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer todoist-token"); return { status: 200, body: { id: "todo-1", url: "https://todoist.com/tasks/todo-1" } }; } }, previousOutputs: {} },
    { content: "Verify integration" });
  assert.deepEqual(result, { taskId: "todo-1", url: "https://todoist.com/tasks/todo-1" });
});

test("Airtable creates a record using the personal access token", async () => {
  const operation = findOperation("airtable", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { airtable: { accessToken: "airtable-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer airtable-token"); return { status: 200, body: { id: "rec-1", createdTime: "2026-11-05T00:00:00.000Z" } }; } }, previousOutputs: {} },
    { baseId: "appABCDEFGHIJKL", tableId: "Leads", fields: { Name: "Ada" } });
  assert.deepEqual(result, { recordId: "rec-1", createdTime: "2026-11-05T00:00:00.000Z" });
});

test("Bitbucket creates a repository issue", async () => {
  const operation = findOperation("bitbucket", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { bitbucket: { accessToken: "bitbucket-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer bitbucket-token"); return { status: 201, body: { id: 42, links: { html: { href: "https://bitbucket.org/acme/app/issues/42" } } } }; } }, previousOutputs: {} },
    { workspace: "acme", repository: "app", title: "Fix bug" });
  assert.deepEqual(result, { issueId: 42, url: "https://bitbucket.org/acme/app/issues/42" });
});

test("Netlify lists bounded site metadata", async () => {
  const operation = findOperation("netlify", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { netlify: { token: "netlify-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer netlify-token"); return { status: 200, body: [{ id: "site-1", name: "Aivanta", ssl_url: "https://aivanta.example.test" }] }; } }, previousOutputs: {} },
    { limit: 5 });
  assert.deepEqual(result, { sites: [{ id: "site-1", name: "Aivanta", url: "https://aivanta.example.test" }] });
});


test("WooCommerce validates HTTPS store origin and creates a customer", async () => {
  const operation = findOperation("woocommerce", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { woocommerce: { storeUrl: "https://shop.example.test", consumerKey: "ck-test", consumerSecret: "cs-test" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /wp-json\/wc\/v3\/customers/); return { status: 201, body: { id: 101, email: "ada@example.test" } }; } }, previousOutputs: {} },
    { email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(result, { customerId: 101, email: "ada@example.test" });
});

test("PayPal obtains a token and creates an order without capturing payment", async () => {
  const operation = findOperation("paypal", "execute", "action"); assert.ok(operation);
  let calls = 0;
  const result = await operation.run({ credentials: { paypal: { clientId: "client-test", clientSecret: "secret-test", environment: "sandbox" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { calls++; if (calls === 1) { assert.match(args.url, /sandbox\.paypal\.com\/v1\/oauth2\/token/); return { status: 200, body: { access_token: "temporary-access-token" } }; } assert.match(args.url, /v2\/checkout\/orders/); return { status: 201, body: { id: "ORDER-1", status: "CREATED", links: [{ rel: "approve", href: "https://paypal.example.test/approve" }] } }; } }, previousOutputs: {} },
    { amount: "12.50", currency: "USD", returnUrl: "https://app.example.test/return", cancelUrl: "https://app.example.test/cancel" });
  assert.equal(calls, 2);
  assert.deepEqual(result, { orderId: "ORDER-1", status: "CREATED", approvalUrl: "https://paypal.example.test/approve" });
});

test("Paddle creates a customer without creating a transaction", async () => {
  const operation = findOperation("paddle", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { paddle: { apiKey: "paddle-test" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer paddle-test"); return { status: 201, body: { data: { id: "ctm_1", email: "ada@example.test" } } }; } }, previousOutputs: {} },
    { email: "ada@example.test", name: "Ada Lovelace" });
  assert.deepEqual(result, { customerId: "ctm_1", email: "ada@example.test" });
});

test("Lemon Squeezy creates a store-scoped customer", async () => {
  const operation = findOperation("lemon_squeezy", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { lemon_squeezy: { apiKey: "lemon-test", storeId: "12345" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Accept, "application/vnd.api+json"); return { status: 201, body: { data: { id: "customer-1", attributes: { email: "ada@example.test" } } } }; } }, previousOutputs: {} },
    { email: "ada@example.test", name: "Ada Lovelace" });
  assert.deepEqual(result, { customerId: "customer-1", email: "ada@example.test" });
});

test("Square creates an idempotent customer in the selected environment", async () => {
  const operation = findOperation("square", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { square: { accessToken: "square-test", environment: "sandbox" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /^https:\/\/connect\.squareupsandbox\.com/); assert.equal(args.headers.Authorization, "Bearer square-test"); return { status: 200, body: { customer: { id: "square-customer", email_address: "ada@example.test" } } }; } }, previousOutputs: {} },
    { email: "ada@example.test", givenName: "Ada" });
  assert.deepEqual(result, { customerId: "square-customer", email: "ada@example.test" });
});

test("Razorpay creates a customer using Basic key authentication", async () => {
  const operation = findOperation("razorpay", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { razorpay: { keyId: "rzp-test", keySecret: "razor-secret" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Basic " + Buffer.from("rzp-test:razor-secret").toString("base64")); return { status: 200, body: { id: "cust_1", email: "ada@example.test" } }; } }, previousOutputs: {} },
    { name: "Ada Lovelace", email: "ada@example.test" });
  assert.deepEqual(result, { customerId: "cust_1", email: "ada@example.test" });
});

test("Zoom lists bounded meeting metadata", async () => {
  const operation = findOperation("zoom", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { zoom: { accessToken: "zoom-test" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer zoom-test"); return { status: 200, body: { meetings: [{ id: 123, topic: "Planning", start_time: "2026-11-05T12:00:00Z" }] } }; } }, previousOutputs: {} },
    { pageSize: 5 });
  assert.deepEqual(result, { meetings: [{ id: 123, topic: "Planning", startTime: "2026-11-05T12:00:00Z" }] });
});

test("Cal.com creates a booking using an explicit event type and attendee", async () => {
  const operation = findOperation("cal_com", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { cal_com: { apiKey: "cal-test" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers["cal-api-version"], "2024-08-13"); return { status: 201, body: { data: { uid: "booking-1", status: "accepted" } } }; } }, previousOutputs: {} },
    { eventTypeId: 10, start: "2026-11-06T10:00:00Z", attendeeName: "Ada", attendeeEmail: "ada@example.test", timeZone: "Africa/Lagos" });
  assert.deepEqual(result, { bookingUid: "booking-1", status: "accepted" });
});

test("Twilio Voice validates an HTTPS TwiML URL before initiating a call", async () => {
  const operation = findOperation("twilio_voice", "execute", "action"); assert.ok(operation);
  const context = { credentials: { twilio_voice: { accountSid: "AC-placeholder-test", authToken: "voice-test", fromPhone: "+15550001111" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /\/Calls\.json$/); return { status: 201, body: { sid: "CA-call-1", status: "queued" } }; } }, previousOutputs: {} };
  const result = await operation.run(context, { to: "+15550002222", twimlUrl: "https://voice.example.test/instructions.xml" });
  assert.deepEqual(result, { callSid: "CA-call-1", status: "queued" });
  await assert.rejects(() => operation.run(context, { to: "+15550002222", twimlUrl: "http://127.0.0.1/unsafe" }), /TWILIO_VOICE_TWIML_URL_INVALID/);
});

test("DocuSign lists envelopes from a validated account API host", async () => {
  const operation = findOperation("docusign", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { docusign: { accessToken: "docusign-test", accountId: "account-1", baseUri: "https://na4.docusign.net" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /restapi\/v2\.1\/accounts\/account-1\/envelopes/); return { status: 200, body: { envelopes: [{ envelopeId: "env-1", status: "sent", emailSubject: "Agreement" }] } }; } }, previousOutputs: {} },
    { fromDate: "2026-11-01T00:00:00Z" });
  assert.deepEqual(result, { envelopes: [{ envelopeId: "env-1", status: "sent", emailSubject: "Agreement" }] });
});


test("X/Twitter publishes a bounded text post", async () => {
  const operation = findOperation("x_twitter", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { x_twitter: { accessToken: "x-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer x-token"); return { status: 201, body: { data: { id: "tweet-1", text: "Hello" } } }; } }, previousOutputs: {} }, { text: "Hello" });
  assert.deepEqual(result, { postId: "tweet-1", text: "Hello" });
});

test("LinkedIn reads the connected member profile", async () => {
  const operation = findOperation("linkedin", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { linkedin: { accessToken: "linkedin-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.url, "https://api.linkedin.com/v2/userinfo"); return { status: 200, body: { sub: "member-1", name: "Ada Lovelace", email: "ada@example.test" } }; } }, previousOutputs: {} }, {});
  assert.deepEqual(result, { memberId: "member-1", name: "Ada Lovelace", email: "ada@example.test" });
});

test("Facebook Pages publishes a text post using a page token", async () => {
  const operation = findOperation("facebook_pages", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { facebook_pages: { pageAccessToken: "page-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer page-token"); return { status: 200, body: { id: "page_1_post_2" } }; } }, previousOutputs: {} }, { pageId: "123456", message: "Hello page" });
  assert.deepEqual(result, { postId: "page_1_post_2" });
});

test("Instagram creates and publishes an image media container", async () => {
  const operation = findOperation("instagram", "execute", "action"); assert.ok(operation);
  let calls = 0;
  const result = await operation.run({ credentials: { instagram: { accessToken: "ig-token", igUserId: "ig-user-1" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { calls++; if (calls === 1) return { status: 200, body: { id: "container-1" } }; assert.equal(args.body.creation_id, "container-1"); return { status: 200, body: { id: "media-1" } }; } }, previousOutputs: {} },
    { imageUrl: "https://cdn.example.test/post.jpg", caption: "Aivanta update" });
  assert.equal(calls, 2);
  assert.deepEqual(result, { mediaId: "media-1" });
});

test("TikTok lists bounded video metadata", async () => {
  const operation = findOperation("tiktok", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { tiktok: { accessToken: "tiktok-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer tiktok-token"); return { status: 200, body: { data: { videos: [{ id: "video-1", title: "Automation", create_time: 1793865600 }] } } }; } }, previousOutputs: {} },
    { maxCount: 5 });
  assert.deepEqual(result, { videos: [{ id: "video-1", title: "Automation", createTime: 1793865600 }] });
});

test("Mailchimp adds an audience member using the API key's server region", async () => {
  const operation = findOperation("mailchimp", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { mailchimp: { apiKey: "test-us20" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.match(args.url, /^https:\/\/us20\.api\.mailchimp\.com/); return { status: 200, body: { id: "member-1", email_address: "ada@example.test", status: "subscribed" } }; } }, previousOutputs: {} },
    { listId: "list-1", email: "ada@example.test", status: "subscribed" });
  assert.deepEqual(result, { memberId: "member-1", email: "ada@example.test", status: "subscribed" });
});

test("Typeform reads form metadata and field count", async () => {
  const operation = findOperation("typeform", "execute", "action"); assert.ok(operation);
  const result = await operation.run({ credentials: { typeform: { accessToken: "typeform-token" } }, logger: { info() {}, error() {} },
    http: { async request(args: any) { assert.equal(args.headers.Authorization, "Bearer typeform-token"); return { status: 200, body: { id: "form-1", title: "Lead intake", fields: [{}, {}, {}] } }; } }, previousOutputs: {} },
    { formId: "form-1" });
  assert.deepEqual(result, { formId: "form-1", title: "Lead intake", questionCount: 3 });
});
