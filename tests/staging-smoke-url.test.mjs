import test from "node:test";
import assert from "node:assert/strict";
import { buildStagingRequestUrl } from "../lib/staging/request-url.mjs";

test("staging request URL keeps an absolute API path on the configured origin", () => {
  const baseUrl = new URL("https://ai-automation-52awb5lpz-veerex-org.vercel.app");
  const requestUrl = buildStagingRequestUrl("/api/health", baseUrl);

  assert.equal(requestUrl.origin, baseUrl.origin);
  assert.equal(requestUrl.hostname, "ai-automation-52awb5lpz-veerex-org.vercel.app");
  assert.equal(requestUrl.pathname, "/api/health");
  assert.equal(requestUrl.href, "https://ai-automation-52awb5lpz-veerex-org.vercel.app/api/health");
});

test("staging request URL does not turn a double-slash API path into a hostname", () => {
  const baseUrl = new URL("https://preview.example.vercel.app/");
  const requestUrl = buildStagingRequestUrl("/api/workflows/actions", baseUrl);

  assert.equal(requestUrl.hostname, "preview.example.vercel.app");
  assert.equal(requestUrl.pathname, "/api/workflows/actions");
  assert.notEqual(requestUrl.hostname, "api");
});
