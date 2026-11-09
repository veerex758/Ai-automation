import test from "node:test";
import assert from "node:assert/strict";
import { processMarketplaceWebhook, type MarketplaceWebhookProcessor } from "../lib/marketplace/payments/process-webhook";
import type { MarketplacePaymentProvider, VerifiedMarketplaceWebhook } from "../lib/marketplace/payments/provider";

const event: VerifiedMarketplaceWebhook = { eventId: "evt_1", type: "payment.succeeded", occurredAt: new Date().toISOString(), data: {} };
const provider: MarketplacePaymentProvider = {
 id: "mock",
 async createCheckout(){ return {checkoutUrl:"https://example.invalid",providerCheckoutId:"checkout"}; },
 async verifyWebhook(raw){ assert.equal(new TextDecoder().decode(raw),"raw-event"); return event; },
 parsePayment(){ return {purchaseId:"purchase_1",providerPaymentId:"pay_1",amountMinor:1200,currency:"USD"}; },
};
const processor: MarketplaceWebhookProcessor={finalizePayment:async(input)=>input,reversePayment:async(input)=>input,applySubscriptionEvent:async(input)=>input};
test("payment webhook passes verified raw digest and normalized data to finalizer",async()=>{
 const result=await processMarketplaceWebhook(provider,processor,new TextEncoder().encode("raw-event"),new Headers(),Date.now());
 assert.equal(result.eventId,"evt_1");
 assert.equal((result.outcome as Record<string,unknown>).purchaseId,"purchase_1");
 assert.equal((result.outcome as Record<string,unknown>).amountMinor,1200);
 assert.match(String((result.outcome as Record<string,unknown>).payloadSha256),/^[a-f0-9]{64}$/);
});
test("webhook rejects empty and oversized bodies before provider verification",async()=>{
 await assert.rejects(()=>processMarketplaceWebhook(provider,processor,new Uint8Array(),new Headers()),/invalid_webhook_body_size/);
 await assert.rejects(()=>processMarketplaceWebhook(provider,processor,new Uint8Array(1_000_001),new Headers()),/invalid_webhook_body_size/);
});
test("webhook rejects stale events before calling processor",async()=>{
 const staleProvider={...provider,verifyWebhook:async()=>({...event,occurredAt:"2000-01-01T00:00:00Z"})};
 let called=false;
 await assert.rejects(()=>processMarketplaceWebhook(staleProvider,{...processor,finalizePayment:async()=>{called=true;}},new TextEncoder().encode("raw-event"),new Headers(),Date.now()),/stale_webhook_event/);
 assert.equal(called,false);
});
test("unknown verified events are acknowledged but never finalized",async()=>{
 const other={...provider,verifyWebhook:async()=>({...event,type:"customer.updated"})};
 let called=false;
 const result=await processMarketplaceWebhook(other,{...processor,finalizePayment:async()=>{called=true;}},new TextEncoder().encode("raw-event"),new Headers(),Date.now());
 assert.equal((result.outcome as {status:string}).status,"ignored");
 assert.equal(called,false);
});

test("verified refund dispatches only to reversal processor",async()=>{
 const refundEvent={...event,type:"refund.succeeded"};
 const refundProvider:MarketplacePaymentProvider={...provider,verifyWebhook:async()=>refundEvent,parseReversal:()=>({purchaseId:"purchase_1",kind:"refund",amountMinor:300})};
 let reversed:unknown;
 const result=await processMarketplaceWebhook(refundProvider,{...processor,reversePayment:async(input)=>{reversed=input;return input;}},new TextEncoder().encode("raw-event"),new Headers(),Date.now());
 assert.equal(result.eventId,"evt_1");
 assert.equal((reversed as {kind:string}).kind,"refund");
 assert.equal((reversed as {amountMinor:number}).amountMinor,300);
});
