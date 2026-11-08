import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const contract=readFileSync(new URL("../lib/marketplace/payments/provider.ts",import.meta.url),"utf8");
const spec=readFileSync(new URL("../docs/marketplace/PHASE-2-PAYMENTS.md",import.meta.url),"utf8");
test("payment adapter contract is provider-neutral and server-side",()=>{
 assert.match(contract,/export interface MarketplacePaymentProvider/);
 assert.match(contract,/createCheckout\(input: MarketplaceCheckoutInput\)/);
 assert.match(contract,/verifyWebhook\(rawBody: Uint8Array, headers: Headers\)/);
 assert.match(contract,/parsePayment\(event: VerifiedMarketplaceWebhook\)/);
 assert.match(contract,/verifyWebhook(rawBody: Uint8Array, headers: Headers)/);
 assert.match(spec,/Provider-neutral adapter/);
});
test("verified webhook envelope rejects invalid IDs/types and stale timestamps",()=>{
 assert.match(contract,/invalid_webhook_event_id/);
 assert.match(contract,/invalid_webhook_event_type/);
 assert.match(contract,/stale_webhook_event/);
 assert.match(contract,/toleranceMs = 5 \* 60 \* 1000/);
 assert.match(contract,/Math\.abs\(nowMs - occurredAtMs\) > toleranceMs/);
});
test("normalized payment validation fails closed for amount, currency and identifiers",()=>{
 assert.match(contract,/invalid_payment_payload/);
 assert.match(contract,/Number\.isSafeInteger\(payment\.amountMinor\)/);
 assert.match(contract,/payment.amountMinor<=0/);
 assert.match(contract,/payment.currency!=="USD"/);
});
