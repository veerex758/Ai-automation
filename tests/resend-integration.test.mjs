import test from "node:test";
import assert from "node:assert/strict";
import { sendResendEmail, validateEmailMessage } from "../lib/integrations/resend.cjs";

const message = { to: "owner@example.com", subject: "Aivanta test", text: "This is a test." };

test("rejects invalid recipient before making a request", async () => {
  let called = false;
  await assert.rejects(
    sendResendEmail({ ...message, to: "not-an-email" }, {
      apiKey: "re_test", from: "Aivanta <hello@example.com>",
      fetchImpl: async () => { called = true; return new Response("{}", { status: 200 }); },
    }),
    /valid recipient email address/,
  );
  assert.equal(called, false);
});

test("requires server-side credentials and sender configuration", async () => {
  await assert.rejects(sendResendEmail(message, { apiKey: "", from: "" }), /RESEND_API_KEY/);
});

test("sends a fixed-provider request with an idempotency key and returns provider ID", async () => {
  let captured;
  const result = await sendResendEmail(message, {
    apiKey: "re_test_secret",
    from: "Aivanta <hello@example.com>",
    idempotencyKey: "workflow-run-123",
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    },
  });
  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(captured.init.headers.Authorization, "Bearer re_test_secret");
  assert.equal(captured.init.headers["Idempotency-Key"], "workflow-run-123");
  assert.deepEqual(captured.body.to, ["owner@example.com"]);
  assert.equal(captured.body.from, "Aivanta <hello@example.com>");
  assert.deepEqual(result, { provider: "resend", messageId: "email_123" });
});

test("does not leak raw provider error bodies", async () => {
  await assert.rejects(
    sendResendEmail(message, {
      apiKey: "re_test", from: "Aivanta <hello@example.com>",
      fetchImpl: async () => new Response(JSON.stringify({ message: "secret internal detail" }), { status: 401 }),
    }),
    (error) => {
      assert.match(error.message, /rejected its server credentials/);
      assert.doesNotMatch(error.message, /secret internal detail/);
      return true;
    },
  );
});

test("maps provider rate limits to a safe retry message", async () => {
  await assert.rejects(
    sendResendEmail(message, {
      apiKey: "re_test", from: "Aivanta <hello@example.com>",
      fetchImpl: async () => new Response("{}", { status: 429 }),
    }),
    (error) => error.code === "PROVIDER_RATE_LIMIT" && /rate limit/.test(error.message),
  );
});

test("validates email subject and body length", () => {
  assert.throws(() => validateEmailMessage({ ...message, subject: "" }), /subjects/);
  assert.throws(() => validateEmailMessage({ ...message, text: "x".repeat(10001) }), /10,000/);
});
