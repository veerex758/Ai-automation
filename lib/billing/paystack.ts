import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
export function createPaymentReference() { return `aivanta_${Date.now().toString(36)}_${randomBytes(12).toString("hex")}`; }
export function isValidPaystackSignature(raw: string, signature: string | null, secret: string) { if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false; const expected = createHmac("sha512", secret).update(raw).digest(); const supplied = Buffer.from(signature, "hex"); return supplied.length === expected.length && timingSafeEqual(supplied, expected); }
export function isVerifiedPayment(data: {status?: unknown; amount?: unknown; currency?: unknown}, expected: {amountMinor:number; currency:string}) { return data.status === "success" && Number.isSafeInteger(data.amount) && data.amount === expected.amountMinor && data.currency === expected.currency; }

export function getPaidPlan(slug:unknown) { if(slug!=="pro-monthly") return null; const n=Number(process.env.AIVANTA_PRO_MONTHLY_AMOUNT_MINOR||1500000); return {slug:"pro-monthly",amountMinor:Number.isSafeInteger(n)&&n>0?n:1500000,currency:process.env.AIVANTA_BILLING_CURRENCY==="USD"?"USD":"NGN"}; }
