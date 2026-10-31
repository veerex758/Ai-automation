import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeUrl = new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url);

test("live registry execution remains limited to the guarded manual-to-Resend path", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /unsupportedLiveStep\s*=\s*steps\.find/);
  assert.match(source, /step\.nodeId === "manual" && step\.operationId === "start"/);
  assert.match(source, /step\.nodeId === "email" && step\.operationId === "send_email"/);
  assert.match(source, /available in dry-run only until its live integration is explicitly enabled/);
  assert.match(source, /AIVANTA_LIVE_EMAIL_RECIPIENTS/);
});

test("unapproved OpenAI, Slack and webhook actions cannot enter the live allowlist", async () => {
  const source = await readFile(routeUrl, "utf8");
  const gate = source.indexOf("const unsupportedLiveStep");
  const emailAllowlist = source.indexOf("const allowed =", gate);
  assert.ok(gate >= 0 && emailAllowlist > gate, "live integration gate must run before recipient allowlist checks");
  const gateSource = source.slice(gate, emailAllowlist);
  assert.doesNotMatch(gateSource, /nodeId === "(openai|slack|webhooks)"/);
});
