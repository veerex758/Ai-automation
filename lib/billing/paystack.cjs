/* global module, process, fetch, Buffer, require */
const { createHmac, timingSafeEqual } = require("node:crypto");

function getSecret(env = process.env) {
  const secret = env.PAYSTACK_SECRET_KEY;
  if (!secret || typeof secret !== "string" || !/^(sk_test_|sk_live_)[A-Za-z0-9]+$/.test(secret)) {
    throw new Error("PAYSTACK_NOT_CONFIGURED");
  }
  return secret;
}

function safeEqualHex(expected, supplied) {
  if (typeof supplied !== "string" || !/^[a-f0-9]{128}$/i.test(supplied)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(supplied, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyPaystackWebhookSignature(rawBody, signature, env = process.env) {
  if (!(typeof rawBody === "string" || Buffer.isBuffer(rawBody))) return false;
  let secret;
  try { secret = getSecret(env); } catch { return false; }
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

async function paystackRequest(path, { method = "GET", body, fetchImpl = fetch, env = process.env } = {}) {
  const secret = getSecret(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl("https://api.paystack.co" + path, {
      method,
      headers: { Authorization: "Bearer " + secret, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: controller.signal,
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error("PAYSTACK_INVALID_RESPONSE"); }
    if (!response.ok || !payload || payload.status !== true) {
      if (response.status === 401 || response.status === 403) throw new Error("PAYSTACK_AUTH_ERROR");
      throw new Error("PAYSTACK_PROVIDER_ERROR");
    }
    return payload.data;
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("PAYSTACK_TIMEOUT");
    if (error instanceof Error && error.message.startsWith("PAYSTACK_")) throw error;
    throw new Error("PAYSTACK_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
}

async function initializePaystackTransaction({ email, amount, currency = "NGN", reference, callbackUrl, metadata, fetchImpl = fetch, env = process.env }) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("PAYSTACK_INVALID_EMAIL");
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("PAYSTACK_INVALID_AMOUNT");
  if (typeof reference !== "string" || !/^[A-Za-z0-9.=-]{8,100}$/.test(reference)) throw new Error("PAYSTACK_INVALID_REFERENCE");
  if (!["NGN", "GHS", "KES", "ZAR", "USD"].includes(currency)) throw new Error("PAYSTACK_INVALID_CURRENCY");
  if (callbackUrl) {
    let parsed;
    try { parsed = new URL(callbackUrl); } catch { throw new Error("PAYSTACK_INVALID_CALLBACK"); }
    if (parsed.protocol !== "https:" && !(env.NODE_ENV !== "production" && parsed.hostname === "localhost")) throw new Error("PAYSTACK_INVALID_CALLBACK");
  }
  const data = await paystackRequest("/transaction/initialize", {
    method: "POST", fetchImpl, env,
    body: { email, amount, currency, reference, ...(callbackUrl ? { callback_url: callbackUrl } : {}), ...(metadata ? { metadata } : {}) },
  });
  if (!data || typeof data.authorization_url !== "string" || !data.authorization_url.startsWith("https://checkout.paystack.com/") || data.reference !== reference) {
    throw new Error("PAYSTACK_INVALID_RESPONSE");
  }
  return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
}

async function verifyPaystackTransaction({ reference, fetchImpl = fetch, env = process.env }) {
  if (typeof reference !== "string" || !/^[A-Za-z0-9.=-]{8,100}$/.test(reference)) throw new Error("PAYSTACK_INVALID_REFERENCE");
  const data = await paystackRequest("/transaction/verify/" + encodeURIComponent(reference), { fetchImpl, env });
  if (!data || data.reference !== reference) throw new Error("PAYSTACK_REFERENCE_MISMATCH");
  return {
    reference: data.reference,
    status: data.status,
    amount: data.amount,
    currency: data.currency,
    customerEmail: data.customer && data.customer.email,
    paidAt: data.paid_at || null,
  };
}

module.exports = { initializePaystackTransaction, verifyPaystackTransaction, verifyPaystackWebhookSignature, safeEqualHex };
