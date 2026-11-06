import { test } from "node:test";
import assert from "node:assert/strict";
import { nodes, findOperation } from "../nodes/registry";
import { executeRegisteredOperation } from "../nodes/runner";
import type { NodeContext } from "../nodes/types";

test("registry includes versioned provider and data utility operations", () => {
  assert.equal(nodes.length, 120);
  assert.ok(findOperation("manual", "start", "trigger"));
  assert.ok(findOperation("webhooks", "receive_event", "trigger"));
  assert.ok(findOperation("http_request", "request", "action"));
  assert.ok(findOperation("wait", "delay", "action"));
  assert.ok(findOperation("loop", "iterate", "action"));
  assert.ok(findOperation("schedule", "scheduled", "trigger"));
  assert.ok(findOperation("javascript", "execute", "action"));
  assert.ok(findOperation("mysql", "query", "action"));
  assert.ok(findOperation("mongodb", "find", "action"));
  assert.ok(findOperation("openai", "generate_text", "action"));
  assert.ok(findOperation("gemini", "generate_text", "action"));
  assert.ok(findOperation("slack", "send_message", "action"));
  assert.ok(findOperation("email", "send_email", "action"));
  assert.ok(findOperation("gmail", "list_messages", "action"));
  assert.ok(findOperation("google_sheets", "get_values", "action"));
  assert.ok(findOperation("slack", "post_message", "action"));
  assert.ok(findOperation("notion", "create_page", "action"));
  assert.ok(findOperation("hubspot", "create_contact", "action"));
  assert.ok(fi¶»§q«^