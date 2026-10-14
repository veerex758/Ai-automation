import test from "node:test";
import assert from "node:assert/strict";
import { handleWorkflowValidation, MAX_BODY_BYTES } from "../lib/workflows/validation-api.cjs";

const jsonRequest = (body, headers = {}) => new Request("https://aivanta.test/api/workflows/validate", {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body,
});

const validator = (input) => ({
  valid: input?.name === "Valid workflow",
  issues: input?.name === "Valid workflow" ? [] : [{ path: "name", message: "Give the workflow a name." }],
});

test("validation API returns 200 for valid workflow definitions without caching", async () => {
  const response = await handleWorkflowValidation(
    jsonRequest(JSON.stringify({ name: "Valid workflow", steps: [] })),
    validator,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { valid: true, issues: [] });
});

test("validation API returns 422 and structured issues for invalid definitions", async () => {
  const response = await handleWorkflowValidation(jsonRequest(JSON.stringify({ name: "" })), validator);
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    valid: false,
    issues: [{ path: "name", message: "Give the workflow a name." }],
  });
});

test("validation API rejects non-JSON content types", async () => {
  const response = await handleWorkflowValidation(
    new Request("https://aivanta.test/api/workflows/validate", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }),
    validator,
  );
  assert.equal(response.status, 415);
});

test("validation API rejects malformed JSON", async () => {
  const response = await handleWorkflowValidation(jsonRequest("{"), validator);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Request body must contain valid JSON." });
});

test("validation API rejects bodies larger than 1 MB", async () => {
  const response = await handleWorkflowValidation(
    jsonRequest(JSON.stringify({ payload: "x".repeat(MAX_BODY_BYTES) })),
    validator,
  );
  assert.equal(response.status, 413);
});

test("validation API rejects an oversized declared content length before reading the body", async () => {
  const request = {
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(MAX_BODY_BYTES + 1),
    }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    }),
  };
  const response = await handleWorkflowValidation(request, validator);
  assert.equal(response.status, 413);
});
