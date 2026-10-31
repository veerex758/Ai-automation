import test from "node:test";
import assert from "node:assert/strict";
import executor from "../lib/workflows/live-action-executor.cjs";

const { executeLiveAction } = executor;
const emailNode = {
  id: "welcome-email",
  type: "action",
  title: "Welcome customer",
  settings: { provider: "email", operation: "send_email", recipient: "staging@example.com", message: "Welcome!" },
};

test("dispatches supported email actions through the injected provider adapter", async () => {
  let call;
  const result = await executeLiveAction(emailNode, {
    idempotencyKey: "run-123",
    sendEmail: async (payload, options) => {
      call = { payload, options };
      return { provider: "resend", messageId: "provider-msg-123" };
    },
  });
  assert.deepEqual(call, {
    payload: { to: "staging@example.com", subject: "Welcome customer", text: "Welcome!" },
    options: { idempotencyKey: "run-123" },
  });
  assert.deepEqual(result, {
    provider: "resend",
    providerMessageId: "provider-msg-123",
    message: "Email accepted by provider.",
  });
});

test("rejects unsupported providers without calling an adapter", async () => {
  let called = false;
  await assert.rejects(
    executeLiveAction({ ...emailNode, settings: { ...emailNode.settings, provider: "slack", operation: "send_message" } }, {
      idempotencyKey: "run-123",
      sendEmail: async () => { called = true; return { messageId: "should-not-exist" }; },
    }),
    { message: "LIVE_ACTION_UNSUPPORTED" },
  );
  assert.equal(called, false);
});

test("requires a message, recipient, adapter, and idempotency key", async () => {
  const options = { idempotencyKey: "run-123", sendEmail: async () => ({ messageId: "m1" }) };
  await assert.rejects(executeLiveAction({ ...emailNode, settings: { ...emailNode.settings, message: " " } }, options), { message: "LIVE_ACTION_CONFIGURATION_INVALID" });
  await assert.rejects(executeLiveAction(emailNode, { idempotencyKey: "run-123" }), { message: "LIVE_ACTION_ADAPTER_MISSING" });
  await assert.rejects(executeLiveAction(emailNode, { sendEmail: options.sendEmail }), { message: "LIVE_ACTION_IDEMPOTENCY_REQUIRED" });
});

test("rejects ambiguous provider responses instead of reporting false success", async () => {
  await assert.rejects(
    executeLiveAction(emailNode, { idempotencyKey: "run-123", sendEmail: async () => ({ provider: "resend" }) }),
    { message: "LIVE_ACTION_PROVIDER_RESULT_INVALID" },
  );
});
