import {createHmac,timingSafeEqual} from "node:crypto";
import type {MarketplacePaymentProvider,MarketplaceCheckoutInput,VerifiedMarketplaceWebhook,ParsedMarketplacePayment,ParsedMarketplaceReversal} from "./provider";
const api="https://api.paystack.co";const obj=(v:unknown):Record<string,any>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,any>:{};
function secret(){const s=process.env.PAYSTACK_SECRET_KEY;if(!s)throw new Error("paystack_not_configured");return s}
function valid(raw:Uint8Array,h:string|null){if(!h||h.length>512)return false;const e=createHmac("sha512",secret()).update(raw).digest();const b=Buffer.from(h,"hex");return b.length===e.length&&timingSafeEqual(b,e)}
export const paystackMarketplaceProvider:MarketplacePaymentProvider={id:"paystack",
 async createCheckout(i:MarketplaceCheckoutInput){if(i.currency!=="USD"||!Number.isSafeInteger(i.amountMinor)||i.amountMinor<0)throw new Error("unsupported_checkout_currency_or_amount");
 const r=await fetch(api+"/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+secret(),"Content-Type":"application/json","Idempotency-Key":i.idempotencyKey},body:JSON.stringify({email:i.buyerEmail,amount:String(i.amountMinor),currency:"USD",reference:i.purchaseId,callback_url:i.successUrl,metadata:{purchaseId:i.purchaseId,buyerId:i.buyerId,productId:i.product.id,versionId:i.versionId},channels:["card"]})});
 const b=obj(await r.json()),d=obj(b.data);if(!r.ok||b.status!==true||typeof d.authorization_url!=="string"||typeof d.reference!=="string")throw new Error("paystack_checkout_failed");return {checkoutUrl:d.authorization_url,providerCheckoutId:d.reference}},
 async verifyWebhook(raw,headers){if(!valid(raw,headers.get("x-paystack-signature")))throw new Error("invalid_paystack_signature");const b=obj(JSON.parse(Buffer.from(raw).toString("utf8"))),d=obj(b.data);
 const map:Record<string,string>={"charge.success":"payment.succeeded","refund.processed":"refund.succeeded","charge.dispute.create":"chargeback.created"};
 return {eventId:String(d.id??d.reference??""),type:map[String(b.event)]??String(b.event??""),occurredAt:String(d.createdAt??d.created_at??b.createdAt??b.created_at??""),data:b} satisfies VerifiedMarketplaceWebhook},
 parsePayment(e){const b=obj(e.data),d=obj(b.data),m=obj(d.metadata);if(b.event!=="charge.success")return null;return {purchaseId:String(m.purchaseId??d.reference??""),providerPaymentId:String(d.id??""),amountMinor:Number(d.amount),currency:String(d.currency??"").toUpperCase()} as ParsedMarketplacePayment},
 parseReversal(e){const b=obj(e.data),d=obj(b.data),m=obj(d.metadata);if(b.event==="refund.processed")return {purchaseId:String(m.purchaseId??obj(d.transaction).reference??""),kind:"refund",amountMinor:Number(d.amount)};if(b.event==="charge.dispute.create")return {purchaseId:String(m.purchaseId??obj(d.transaction).reference??""),kind:"chargeback",amountMinor:Number(d.amount)};return null as ParsedMarketplaceReversal|null}
};
