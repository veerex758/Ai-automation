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

test("Google Drive get_file uses read-only metadata lookup", async () => {
  let request: any;
  const operation = findOperation("google_drive", "get_file", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { google_drive: { accessToken: "drive-test-token" } }, logger,
    http: { async request(args: any) { request = args; return { status: 200, body: { id: "file-1", name: "Quarterly report", mimeType: "application/pdf", modifiedTime: "2026-11-01T12:00:00Z" } }; } },
    previousOutputs: {},
  }, { fileId: "file-1" });
  assert.equal(request.method, "GET");
  assert.match(request.url, /drive\/v3\/files\/file-1/);
  assert.equal(request.headers.Authorization, "Bearer drive-test-token");
  assert.deepEqual(result, { id: "file-1", name: "Quarterly report", mimeType: "application/pdf", modifiedTime: "2026-11-01T12:00:00Z" });
});

test("Google Calendar get_event safely encodes calendar and event identifiers", async () => {
  let request: any;
  const operation = findOperation("google_calendar", "get_event", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { google_calendar: { accessToken: "calendar-test-token" } }, logger,
    http: { async request(args: any) { request = args; return { status: 200, body: { id: "event-1", summary: "Planning", start: { dateTime: "2026-11-07T10:00:00Z" }, end: { dateTime: "2026-11-07T10:30:00Z" } } }; } },
    previousOutputs: {},
  }, { calendarId: "primary", eventId: "event/1" });
  assert.equal(request.method, "GET");
  assert.match(request.url, /calendars\/primary\/events\/event%2F1/);
  assert.deepEqual(result, { id: "event-1", summary: "Planning", start: { dateTime: "2026-11-07T10:00:00Z" }, end: { dateTime: "2026-11-07T10:30:00Z" } });
});

test("Discord get_channel reads only bounded channel metadata", async () => {
  let request: any;
  const operation = findOperation("discord", "get_channel", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { discord: { botToken: "discord-test-token" } }, logger,
    http: { async request(args: any) { request = args; return { status: 200, body: { id: "123456789", name: "general", type: 0, guild_id: "987654321", topic: "private topic" } }; } },
    previousOutputs: {},
  }, { channelId: "123456789" });
  assert.equal(request.method, "GET");
  assert.equal(request.headers.Authorization, "Bot discord-test-token");
  assert.deepEqual(result, { channelId: "123456789", name: "general", type: 0, guildId: "987654321" });
});

test("Telegram get_chat calls Bot API and returns normalized chat metadata", async () => {
  let request: any;
  const operation = findOperation("telegram", "get_chat", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { telegram: { botToken: "telegram-test-token" } }, logger,
    http: { async request(args: any) { request = args; return { status: 200, body: { ok: true, result: { id: -123, type: "supergroup", title: "Aivanta team", username: "aivanta_team" } } }; } },
    previousOutputs: {},
  }, { chatId: "-123" });
  assert.match(request.url, /getChat\?chat_id=-123/);
  assert.deepEqual(result, { chatId: -123, type: "supergroup", title: "Aivanta team", username: "aivanta_team" });
});

test("WhatsApp Business get_phone_number uses configured phone ID and token", async () => {
  let request: any;
  const operation = findOperation("whatsapp_business", "get_phone_number", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { whatsapp_business: { accessToken: "wa-test-token", phoneNumberId: "555000111" } }, logger,
    http: { async request(args: any) { request = args; return { status: 200, body: { id: "555000111", display_phone_number: "+1555000111", verified_name: "Aivanta" } }; } },
    previousOutputs: {},
  }, {});
  assert.match(request.url, /555000111\?fields=/);
  assert.equal(request.headers.Authorization, "Bearer wa-test-token");
  assert.deepEqual(result, { phoneNumberId: "555000111", displayPhoneNumber: "+1555000111", verifiedName: "Aivanta" });
});
