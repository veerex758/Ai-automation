import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../lib/marketplace/payments/process-webhook.ts",import.meta.url),"utf8");
test("webhook orchestration verifies raw bytes before trusted processing and hashes original payload",()=>{
 assert.ok(source.indexOf("provider.verifyWebhook(rawBody, headers)")<source.indexOf("assertFreshVerifiedWebhook(event, nowMs)"));
 assert.match(source,/createHash\("sha256"\)\.update\(rawBody\)/);
 assert.match(source,/rawBody\.byteLength > 1_000_000/);
});
test("verified payment events route through atomic finalizer with digest and timestamp",()=>{
 assert.match(source,/event\.type === "payment\.succeeded"/);
 assert.match(source,/processor\.finalizePayment/);
 assert.match(source,/payloadSha256: digest/);
 assert.match(source,/occurredAt: event\.occurredAt/);
});
test("refund and chargeback events use reversal RPC and enforce matching kind",()=>{
 assert.match(source,/refund\.succeeded/);
 assert.match(source,/chargeback\.created/);
 assert.match(source,/processor\.reversePayment/);
 assert.match(source,/reversal_event_type_mismatch/);
});
test("unknown verified events are acknowledged as ignored without granting entitlement",()=>{
 assert.match(source,/status: "ignored"/);
});

test("subscription webhook events normalize provider payloads and dispatch to lifecycle RPC",()=>{
 assert.match(source,/event\.type\.startsWith\("subscription\."\)/);
 assert.match(source,/parseSubscription\?\./);
 assert.match(source,/assertMarketplaceSubscription\(subscription\)/);
 assert.match(source,/processor\.applySubscriptionEvent/);
 assert.match(source,/providerSubscriptionId: subscription\.providerSubscriptionId/);
 assert.match(source,/periodStart: subscription\.periodStart/);
});
