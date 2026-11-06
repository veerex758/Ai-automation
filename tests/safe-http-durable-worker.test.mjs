import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performSafeHttpRequest } from "../nodes/safe-http.ts";

test("safe HTTP transport rejects loopback and private-network destinations before connecting", async () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://10.0.0.8/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://localhost/",
    "http://service.internal/",
  ]) {
    await assert.rejects(
      () => performSafeHttpRequest({ url, method: "GET", headers: {}, timeoutMs: 1000 }),
      /HTTP_REQUEST_PRIVATE_HOST_BLOCKED/,
      url,
    );
  }
});

test("safe HTTP transport rejects unsupported URL schemes, credentials, ports and sensitive headers", async () => {
  const base = { method: "GET" as const, timeoutMs: 1000 };
  await assert.rejects(() => performSafeHttpRequest({ ...base, url: "file:///etc/passwd", headers: {} }), /HTTP_REQUEST_INVALID_URL/);
  await assert.rejects(() => performSafeHttpRequest({ ...base, url: "https://user:pass@example.com/", headers: {} }), /HTTP_REQUEST_INVALID_URL/);
  await assert.rejects(() => performSafeHttpRequest({ ...base, url: "https://example.com:8443/", headers: {} }), /HTTP_REQUEST_PORT_NOT_ALLOWED/);
  await assert.rejects(() => performSafeHttpRequest({ ...base, url: "https://example.com/", headers: { Host: "127.0.0.1" } }), /HTTP_REQUEST_HEADER_NOT_ALLOWED/);
  await assert.rejects(() => performSafeHttpRequest({ ...base, url: "https://example.com/", headers: { Cookie: "session=secret" } }), /HTTP_REQUEST_HEADER_NOT_ALLOWED/);
});

test("durable worker routes node HTTP calls through the SSRF-safe transport", async () => {
  const source = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ performSafeHttpRequest \} from "@\/nodes\/safe-http"/);
  assert.match(source, /const response = await performSafeHttpRequest\(/);
  assert.doesNotMatch(source, /const response = await fetch\(args\.url/);
});
