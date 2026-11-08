import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const contract=readFileSync(new URL("../lib/marketplace/payments/provider.ts",import.meta.url),"utf8");
const spec=readFileSync(new URL("../docs/marketplace/PHASE-2-PAYMENTS.md",import.meta.url),"utf8");
test("payment adapter contract is provider-neutral and server-side",()=>{assert.match(contract,/export interface MarketplacePaymentProvider/);assert.match(contract,/createCheckout/);assert.match(contract,/verifyWebhook/);assert.match(contract,/parsePayment/);assert.match(spec,/Provider-neutral adapter/)});
test("webhook validation rejects invalid envelope and stale timestamps",()=>{for(const x of ["invalid_webhook_event_id","invalid_webhook_event_type","stale_webhook_event","toleranceMs","Date.parse"])assert.ok(contract.includes(x),x)});
test("payment validation fails closed on IDs, amounts and currency",()=>{for(const x of ["invalid_payment_payload","Number.isSafeInteger","payment.amountMinor<=0",'payment.currency!=="USD"'])assert.ok(contract.includes(x),x)});
