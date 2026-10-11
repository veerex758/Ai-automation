import test from "node:test";
import assert from "node:assert/strict";
import { sendResendEmail, validateEmailMessage, getAllowedRecipients, isLiveEmailRecipientAllowed } from "../lib/integrations/resend.cjs";

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
  assert.equal(captured.init.redirect, "error");
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

test("recipient allowlist normalizes case, trims entries, and ignores invalid addresses", () => {
  assert.deepEqual(getAllowedRecipients(" Owner@example.com, invalid, owner@example.com, second@example.org "), ["owner@example.com", "second@example.org"]);
  assert.equal(isLiveEmailRecipientAllowed("OWNER@example.com", "owner@example.com"), true);
  assert.equal(isLiveEmailRecipientAllowed("other@example.com", "owner@example.com"), false);
  assert.equal(isLiveEmailRecipientAllowed("owner@example.com", ""), false);
});

test("sanitizes low-level network errors before they can reach run history", async () => {
  await assert.rejects(
    sendResendEmail(message, {
      apiKey: "re_test", from: "Aivanta <hello@example.com>",
      fetchImpl: async () => { throw new TypeError("socket ECONNRESET at internal-host:443"); },
    }),
    (error) => {
      assert.equal(error.code, "PROVIDER_NETWORK_ERROR");
      assert.equal(error.message, "The email provider request failed before a response was received.");
      assert.doesNotMatch(error.message, /internal-host|ECONNRESET/);
      return true;
    },
  );
});

test("preserves the safe timeout error for aborted provider requests", async () => {
  await assert.rejects(
    sendResendEmail(message, {
      apiKey: "re_test", from: "Aivanta <hello@example.com>",
      fetchImpl: async (_url, init) => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    }),
    (error) => error.code === "PROVIDER_TIMEOUT" && error.message === "The email provider request timed out.",
  );
});

test("classifies malformed successful provider responses separately from network failures", async () => {
  await assert.rejects(
    sendResendEmail(message, {
      apiKey: "re_test", from: "Aivanta <hello@example.com>",
      fetchImpl: async () => new Response(JSON.stringify({ unexpected: "payload" }), { status: 200 }),
    }),
    (error) => {
      assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
      assert.equal(error.message, "The email provider returned an unexpected response.");
      assert.doesNotMatch(error.message, /payload|unexpected: /);
      return true;
    },
  );
});
