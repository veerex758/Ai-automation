import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export type PaidPlanSlug = "starter-monthly" | "starter-annual" | "pro-monthly" | "pro-annual" | "business-monthly" | "business-annual";
export type PaidPlan = { slug: PaidPlanSlug; planKey: "starter" | "pro" | "business"; interval: "month" | "year"; amountMinor: number; currency: "NGN" | "USD" };

const planConfig: Record<PaidPlanSlug, { planKey: PaidPlan["planKey"]; interval: PaidPlan["interval"]; env: string }> = {
  "starter-monthly": { planKey: "starter", interval: "month", env: "AIVANTA_STARTER_MONTHLY_AMOUNT_MINOR" },
  "starter-annual": { planKey: "starter", interval: "year", env: "AIVANTA_STARTER_ANNUAL_AMOUNT_MINOR" },
  "pro-monthly": { planKey: "pro", interval: "month", env: "AIVANTA_PRO_MONTHLY_AMOUNT_MINOR" },
  "pro-annual": { planKey: "pro", interval: "year", env: "AIVANTA_PRO_ANNUAL_AMOUNT_MINOR" },
  "business-monthly": { planKey: "business", interval: "month", env: "AIVANTA_BUSINESS_MONTHLY_AMOUNT_MINOR" },
  "business-annual": { planKey: "business", interval: "year", env: "AIVANTA_BUSINESS_ANNUAL_AMOUNT_MINOR" },
};
export function createPaymentReference() { return `aivanta_${Date.now().toString(36)}_${randomBytes(12).toString("hex")}`; }
export function isValidPaystackSignature(raw: string, signature: string | null, secret: string) {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(raw).digest(), supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function isVerifiedPayment(data: { status?: unknown; amount?: unknown; currency?: unknown; id?: unknown }, expected: { amountMinor: number; currency: string }) {
  return data.status === "success" && Number.isSafeInteger(data.amount) && data.amount === expected.amountMinor && data.currency === expected.currency && Number.isSafeInteger(data.id) && Number(data.id) > 0;
}
export function getPaidPlan(slug: unknown): PaidPlan | null {
  if (typeof slug !== "string" || !(slug in planConfig)) return null;
  const key = slug as PaidPlanSlug, config = planConfig[key], raw = process.env[config.env], amountMinor = raw ? Number(raw) : NaN, currency = process.env.AIVANTA_BILLING_CURRENCY;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || (currency !== "NGN" && currency !== "USD")) return null;
  return { slug: key, ...config, amountMinor, currency };
}
