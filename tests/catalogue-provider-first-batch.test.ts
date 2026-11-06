import test from "node:test";
import assert from "node:assert/strict";
import { findOperation } from "../nodes/registry";

const logger = { info() {}, error() {} };

test("Gmail get_message uses read-only metadata endpoint and normalizes headers", async () => {
  let request: any;
  const operation = findOperation("gmail", "get_message", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { gmail: { accessToken: "google-test-token" } }, logger,
    http: { async request(args: any) {
      request = args;
      return { status: 200, body: {
        id: "message-1", threadId: "thread-1", snippet: "A bounded preview",
        payload: { headers: [{ name: "Subject", value: "Hello" }, { name: "From", value: "sender@example.test" }] },
      } };
    } },
    previousOutputs: {},
  }, { messageId: "message-1" });
  assert.match(request.url, /messages\/message-1/);
  assert.match(request.url, /format=metadata/);
  assert.equal(request.method, "GET");
  assert.equal(request.headers.Authorization, "Bearer google-test-token");
  assert.deepEqual(result, {
    id: "message-1", threadId: "thread-1", snippet: "A bounded preview",
    headers: { subject: "Hello", from: "sender@example.test" },
  });
});

test("HubSpot search_contacts sends an exact-email CRM search and bounds returned fields", async () => {
  let request: any;
  const operation = findOperation("hubspot", "search_contacts", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { hubspot: { accessToken: "hubspot-test-token" } }, logger,
    http: { async request(args: any) {
      request = args;
      return { status: 200, body: { results: [
        { id: "contact-1", properties: { email: "person@example.test", firstname: "Ada", lastname: "Lovelace", secret: "not returned" } },
        { properties: { email: "invalid-row@example.test" } },
      ] } };
    } },
    previousOutputs: {},
  }, { email: "person@example.test" });
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://api.hubapi.com/crm/v3/objects/contacts/search");
  assert.equal(request.headers.Authorization, "Bearer hubspot-test-token");
  assert.deepEqual(request.body.filterGroups[0].filters[0], { propertyName: "email", operator: "EQ", value: "person@example.test" });
  assert.deepEqual(result, { contacts: [{ contactId: "contact-1", email: "person@example.test", firstName: "Ada", lastName: "Lovelace" }] });
});

test("new Google and CRM actions fail closed without workspace credentials", async () => {
  const gmail = findOperation("gmail", "get_message", "action");
  const hubspot = findOperation("hubspot", "search_contacts", "action");
  assert.ok(gmail && hubspot);
  const context = { credentials: {}, logger, http: { async request() { throw new Error("network must not be reached"); } }, previousOutputs: {} };
  await assert.rejects(() => gmail.run(context, { messageId: "message-1" }), /GMAIL_CONNECTION_REQUIRED/);
  await assert.rejects(() => hubspot.run(context, { email: "person@example.test" }), /HUBSPOT_CONNECTION_REQUIRED/);
});
