import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { getUnsupportedRequestedCapabilities } = require("../lib/workflows/ai-request-capability-guard.cjs");

const catalog = [
  { id: "gmail", triggers: [], actions: [{ id: "list_messages", name: "List messages" }, { id: "get_message", name: "Get message" }] },
  { id: "google_sheets", triggers: [], actions: [{ id: "get_values", name: "Get values" }, { id: "get_spreadsheet", name: "Get spreadsheet metadata" }] },
  { id: "slack", triggers: [], actions: [{ id: "post_message", name: "Post channel message" }] },
];

test("rejects new Gmail email trigger requests when Gmail has no registered trigger", () => {
  const issues = getUnsupportedRequestedCapabilities("When a new email arrives in Gmail, qualify it", catalog);
  assert.deepEqual(issues.map((issue) => issue.capability), ["gmail_new_email_trigger"]);
});

test("rejects Google Sheets write requests when only read operations are registered", () => {
  const issues = getUnsupportedRequestedCapabilities("Send qualified leads to Google Sheets", catalog);
  assert.deepEqual(issues.map((issue) => issue.capability), ["google_sheets_write"]);
});

test("allows requests that use only capabilities present in the executable registry", () => {
  assert.deepEqual(getUnsupportedRequestedCapabilities("List Gmail messages, qualify them with Gemini, and send a Slack message", catalog), []);
});

test("allows Gmail and Sheets requests when the required operations are genuinely registered", () => {
  const capable = [
    { ...catalog[0], triggers: [{ id: "new_message", name: "New message" }] },
    { ...catalog[1], actions: [...catalog[1].actions, { id: "append_row", name: "Append row" }] },
    catalog[2],
  ];
  assert.deepEqual(getUnsupportedRequestedCapabilities("When a new email arrives, save leads to Google Sheets", capable), []);
});
