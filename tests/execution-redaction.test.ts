import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveData } from "../lib/integrations/redact-sensitive";

test("redacts sensitive fields and auth headers recursively", () => {
  assert.deepEqual(redactSensitiveData({
    headers: { authorization: "Bearer abc123" },
    output: { access_token: "private", message: "sent" },
    nested: [{ password: "pw", ok: true }],
  }), {
    headers: "[REDACTED]",
    output: { access_token: "[REDACTED]", message: "sent" },
    nested: [{ password: "[REDACTED]", ok: true }],
  });
});

test("redacts known workspace credential values from arbitrary output strings", () => {
  const result = redactSensitiveData({
    message: "provider rejected secret-value",
    error: "Authorization: Bearer abc123",
  }, ["secret-value"]) as { message: string; error: string };
  assert.equal(result.message, "provider rejected [REDACTED]");
  assert.match(result.error, /^Authorization: Bearer /);
  assert.doesNotMatch(result.error, /abc123/);
});
