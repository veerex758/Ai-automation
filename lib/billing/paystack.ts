import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export type PaidPlan = {
  slug: "pro-monthly";
  amountMinor: number;
  currency: "NGN" | "USD";
};

export function createPaymentReference() {
  return `aivanta_${Date.now().toString(36)}_${randomBytes(12).toString("hex")}`;
}

export function isValidPaystackSignature(raw: string, signature: string | null, secret: string) {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(raw).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function isVerifiedPayment(
  data: { status?: unknown; amount?: unknown; currency?: unknown },
  expected: { amountMinor: number; currency: string },
) {
  return data.status === "success"
    && Number.isSafeInteger(data.amount)
    && data.amount === expected.amountMinor
    && data.currency === expected.currency;
}

/** Pricing must be explicitly configured; never silently charge a guessed default. */
export function getPaidPlan(slug: unknown): PaidPlan | null {
  if (slug !== "pro-monthly") return null;
  const configuredAmount = process.env.AIVANTA_PRO_MONTHLY_AMOUNT_MINOR;
  const amountMinor = configuredAmount ? Number(configuredAmount) : NaN;
  const currency = process.env.AIVANTA_BILLING_CURRENCY;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  if (currency !== "NGN" && currency !== "USD") return null;
  return { slug: "pro-monthly", amountMinor, currency };
}
