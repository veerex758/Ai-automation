import test from "node:test";
import assert from "node:assert/strict";
import { emailNode } from "../nodes/email";
import type { NodeContext } from "../nodes/types";

function context(status: number, body: unknown = { id: "email_123" }, idempotencyKey = "rexnora:job-123:email-step") {
  let captured: Parameters<NodeContext["http"]["request"]>[0] | null = null;
  const value: NodeContext = {
    credentials: { resend: { apiKey: "test-api-key", fromEmail: "Rexnora <onboarding@example.com>" } },
    logger: { info() {}, error() {} },
    previousOutputs: {},
    idempotencyKey,
    http: {
      async request(args) {
        captured = args;
        return { status, body };
      },
    },
  };
  return { value, captured: () => captured };
}

test("Resend email request carries the stable per-step idempotency key", async () => {
  const ctx = context(200);
  const result = await emailNode.actions[0].run(ctx.value, {
    to: "agency@example.com", subject: "New enquiry", text: "A qualified lead arrived",
  });
  assert.deepEqual(result, { accepted: true, messageId: "email_123", provider: "resend" });
  assert.equal(ctx.captured()?.headers?.["Idempotency-Key"], "rexnora:job-123:email-step");
  assert.equal(ctx.captured()?.method, "POST");
});

test("Resend rate limits and transient server errors are retryable classifications", async () => {
  for (const [status, expected] of [[429, "EMAIL_RATE_LIMITED"], [500, "EMAIL_PROVIDER_TRANSIENT_FAILURE"], [408, "EMAIL_PROVIDER_TRANSIENT_FAILURE"]] as const) {
    const ctx = context(status, { message: "temporary failure" });
    await assert.rejects(
      emailNode.actions[0].run(ctx.value, {
        to: "agency@example.com", subject: "New enquiry", text: "A qualified lead arrived",
      }),
      (error: unknown) => error instanceof Error && error.message === expected,
    );
  }
});

test("Resend permanent rejection and idempotency payload conflicts are not classified as transient", async () => {
  const rejected = context(400, { message: "invalid recipient" });
  await assert.rejects(
    emailNode.actions[0].run(rejected.value, {
      to: "agency@example.com", subject: "New enquiry", text: "A qualified lead arrived",
    }),
    (error: unknown) => error instanceof Error && error.message === "EMAIL_PROVIDER_REJECTED",
  );
  const conflict = context(409, { name: "invalid_idempotent_request" });
  await assert.rejects(
    emailNode.actions[0].run(conflict.value, {
      to: "agency@example.com", subject: "New enquiry", text: "A qualified lead arrived",
    }),
    (error: unknown) => error instanceof Error && error.message === "EMAIL_PROVIDER_REJECTED",
  );
});

test("Resend concurrent idempotent request is safe to retry with the same key", async () => {
  const ctx = context(409, { name: "concurrent_idempotent_requests" });
  await assert.rejects(
    emailNode.actions[0].run(ctx.value, {
      to: "agency@example.com", subject: "New enquiry", text: "A qualified lead arrived",
    }),
    (error: unknown) => error instanceof Error && error.message === "EMAIL_IDEMPOTENCY_IN_PROGRESS",
  );
});
