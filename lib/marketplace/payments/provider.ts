/**
 * Server-only, provider-neutral marketplace payment contract.
 * Provider adapters verify raw webhook bytes before returning trusted events.
 */
export type MarketplaceCheckoutInput = {
 purchaseId:string;idempotencyKey:string;amountMinor:number;currency:"USD";
 product:{id:string;slug:string;name:string};versionId:string;buyerId:string;buyerEmail:string;
 successUrl:string;cancelUrl:string;billingInterval?:"month"|"year";
};
export type VerifiedMarketplaceWebhook={eventId:string;type:string;occurredAt:string;data:unknown};
export type ParsedMarketplaceReversal={purchaseId:string;kind:"refund"|"chargeback";amountMinor:number};
export type ParsedMarketplacePayment={purchaseId:string;providerPaymentId:string;amountMinor:number;currency:string};
export interface MarketplacePaymentProvider {
 readonly id:string;
 createCheckout(input:MarketplaceCheckoutInput):Promise<{checkoutUrl:string;providerCheckoutId:string}>;
 verifyWebhook(rawBody:Uint8Array,headers:Headers):Promise<VerifiedMarketplaceWebhook>;
 parsePayment(event:VerifiedMarketplaceWebhook):ParsedMarketplacePayment|null;
 parseReversal?(event:VerifiedMarketplaceWebhook):ParsedMarketplaceReversal|null;
}
export function assertFreshVerifiedWebhook(event:VerifiedMarketplaceWebhook,nowMs=Date.now(),toleranceMs=5*60*1000):void{
 if(!event||typeof event.eventId!=="string"||event.eventId.length<1||event.eventId.length>255)throw new Error("invalid_webhook_event_id");
 if(typeof event.type!=="string"||event.type.length<1||event.type.length>160)throw new Error("invalid_webhook_event_type");
 const ms=Date.parse(event.occurredAt);if(!Number.isFinite(ms)||Math.abs(nowMs-ms)>toleranceMs)throw new Error("stale_webhook_event");
}
export function assertMarketplacePayment(payment:ParsedMarketplacePayment|null):asserts payment is ParsedMarketplacePayment{
 if(!payment||!payment.purchaseId||!payment.providerPaymentId)throw new Error("invalid_payment_payload");
 if(!Number.isSafeInteger(payment.amountMinor)||payment.amountMinor<=0||payment.currency!=="USD")throw new Error("invalid_payment_amount");
}
