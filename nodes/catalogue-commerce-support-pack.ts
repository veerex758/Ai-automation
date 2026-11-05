import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NodeContext, NodeDefinition } from "./types";

type ProviderId = "woocommerce" | "paypal" | "paddle" | "lemon_squeezy" | "square" | "razorpay" | "zoom" | "cal_com" | "twilio_voice" | "docusign";
function secret(ctx: NodeContext, provider: ProviderId, field: string): string {
  const value = ctx.credentials[provider]?.[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value.trim();
}
async function request(ctx: NodeContext, provider: ProviderId, args: { url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }): Promise<unknown> {
  const response = await ctx.http.request({ url: args.url, method: args.method ?? "GET", headers: args.headers, ...(args.body === undefined ? {} : { body: args.body }), timeoutMs: 20000, retries: 0 });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("Commerce/support provider request failed", { provider, status: response.status });
    throw new Error(response.status === 429 ? provider.toUpperCase() + "_RATE_LIMITED" : provider.toUpperCase() + "_REQUEST_FAILED");
  }
  return response.body;
}
function node<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(args: {
  id: ProviderId; name: string; description: string; input: I; output: O; auth: NodeDefinition["auth"];
  run(ctx: NodeContext, input: z.infer<I>): Promise<unknown>;
}): NodeDefinition {
  return { id: args.id, name: args.name, icon: "plug", category: ["zoom", "cal_com", "twilio_voice", "docusign"].includes(args.id) ? "communication" : "data", version: 1, auth: args.auth, triggers: [],
    actions: [{ id: "execute", name: args.name + " action", description: args.description, inputSchema: args.input, outputSchema: args.output,
      async run(ctx, raw) { const input = args.input.parse(raw); return args.output.parse(await args.run(ctx, input)); } }] };
}

export const catalogueCommerceSupportNodes: NodeDefinition[] = [
  node({
    id: "woocommerce", name: "WooCommerce", auth: { type: "apiKey", credentialKey: "consumerKey" },
    description: "Creates a WooCommerce customer in the configured HTTPS store using the store's consumer key and secret.",
    input: z.object({ email: z.string().email(), firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional() }).strict(),
    output: z.object({ customerId: z.number().int(), email: z.string().email() }).strict(),
    async run(ctx, input) {
      const store = secret(ctx, "woocommerce", "storeUrl");
      let base: URL; try { base = new URL(store); } catch { throw new Error("WOOCOMMERCE_CONNECTION_INVALID"); }
      if (base.protocol !== "https:" || base.username || base.password || base.hostname === "localhost" || base.hostname.endsWith(".local")) throw new Error("WOOCOMMERCE_CONNECTION_INVALID");
      const auth = Buffer.from(secret(ctx, "woocommerce", "consumerKey") + ":" + secret(ctx, "woocommerce", "consumerSecret")).toString("base64");
      const body = await request(ctx, "woocommerce", { url: base.origin + "/wp-json/wc/v3/customers", method: "POST", headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" },
        body: { email: input.email, first_name: input.firstName ?? "", last_name: input.lastName ?? "" } }) as Record<string, unknown>;
      if (typeof body?.id !== "number" || typeof body.email !== "string") throw new Error("WOOCOMMERCE_INVALID_RESPONSE");
      return { customerId: body.id, email: body.email };
    },
  }),
  node({
    id: "paypal", name: "PayPal", auth: { type: "apiKey", credentialKey: "clientId" },
    description: "Creates a PayPal checkout order without capturing payment. Uses explicit sandbox/live credentials and returns the approval URL.",
    input: z.object({ amount: z.string().regex(/^\d{1,10}\.\d{2}$/), currency: z.string().regex(/^[A-Z]{3}$/), referenceId: z.string().max(100).optional(), returnUrl: z.string().url(), cancelUrl: z.string().url() }).strict(),
    output: z.object({ orderId: z.string(), status: z.string(), approvalUrl: z.string().url().optional() }).strict(),
    async run(ctx, input) {
      const environment = secret(ctx, "paypal", "environment");
      if (environment !== "sandbox" && environment !== "live") throw new Error("PAYPAL_CONNECTION_INVALID");
      const origin = environment === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
      const auth = Buffer.from(secret(ctx, "paypal", "clientId") + ":" + secret(ctx, "paypal", "clientSecret")).toString("base64");
      const tokenBody = await request(ctx, "paypal", { url: origin + "/v1/oauth2/token", method: "POST", headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }) as Record<string, unknown>;
      if (typeof tokenBody?.access_token !== "string") throw new Error("PAYPAL_TOKEN_INVALID");
      const body = await request(ctx, "paypal", { url: origin + "/v2/checkout/orders", method: "POST", headers: { Authorization: "Bearer " + tokenBody.access_token, "Content-Type": "application/json" },
        body: { intent: "CAPTURE", purchase_units: [{ ...(input.referenceId ? { reference_id: input.referenceId } : {}), amount: { currency_code: input.currency, value: input.amount } }], application_context: { return_url: input.returnUrl, cancel_url: input.cancelUrl } } }) as Record<string, any>;
      const approval = Array.isArray(body?.links) ? body.links.find((link: any) => link?.rel === "approve")?.href : undefined;
      if (typeof body?.id !== "string" || typeof body?.status !== "string") throw new Error("PAYPAL_INVALID_RESPONSE");
      return { orderId: body.id, status: body.status, ...(typeof approval === "string" ? { approvalUrl: approval } : {}) };
    },
  }),
  node({
    id: "paddle", name: "Paddle", auth: { type: "apiKey", credentialKey: "apiKey" },
    description: "Creates a Paddle customer record using the saved API key; it does not create a transaction or charge.",
    input: z.object({ email: z.string().email(), name: z.string().trim().min(1).max(200) }).strict(),
    output: z.object({ customerId: z.string(), email: z.string().email() }).strict(),
    async run(ctx, input) {
      const body = await request(ctx, "paddle", { url: "https://api.paddle.com/customers", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "paddle", "apiKey"), "Content-Type": "application/json", "Paddle-Version": "1" }, body: { email: input.email, name: input.name } }) as Record<string, any>;
      if (typeof body?.data?.id !== "string" || typeof body.data.email !== "string") throw new Error("PADDLE_INVALID_RESPONSE");
      return { customerId: body.data.id, email: body.data.email };
    },
  }),
  node({
    id: "lemon_squeezy", name: "Lemon Squeezy", auth: { type: "apiKey", credentialKey: "apiKey" },
    description: "Creates a Lemon Squeezy customer in the configured store using the saved API key.",
    input: z.object({ email: z.string().email(), name: z.string().trim().min(1).max(200) }).strict(),
    output: z.object({ customerId: z.string(), email: z.string().email() }).strict(),
    async run(ctx, input) {
      const body = await request(ctx, "lemon_squeezy", { url: "https://api.lemonsqueezy.com/v1/customers", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "lemon_squeezy", "apiKey"), Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" },
        body: { data: { type: "customers", attributes: { name: input.name, email: input.email }, relationships: { store: { data: { type: "stores", id: secret(ctx, "lemon_squeezy", "storeId") } } } } } }) as Record<string, any>;
      if (typeof body?.data?.id !== "string" || typeof body.data.attributes?.email !== "string") throw new Error("LEMON_SQUEEZY_INVALID_RESPONSE");
      return { customerId: body.data.id, email: body.data.attributes.email };
    },
  }),
  node({
    id: "square", name: "Square", auth: { type: "apiKey", credentialKey: "accessToken" },
    description: "Creates a Square customer in the selected sandbox or production environment using an idempotent request.",
    input: z.object({ email: z.string().email(), givenName: z.string().max(100).optional(), familyName: z.string().max(100).optional() }).strict(),
    output: z.object({ customerId: z.string(), email: z.string().email().optional() }).strict(),
    async run(ctx, input) {
      const environment = secret(ctx, "square", "environment");
      if (environment !== "sandbox" && environment !== "production") throw new Error("SQUARE_CONNECTION_INVALID");
      const origin = environment === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
      const body = await request(ctx, "square", { url: origin + "/v2/customers", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "square", "accessToken"), "Square-Version": "2025-10-16", "Content-Type": "application/json" },
        body: { idempotency_key: randomUUID(), email_address: input.email, ...(input.givenName ? { given_name: input.givenName } : {}), ...(input.familyName ? { family_name: input.familyName } : {}) } }) as Record<string, any>;
      if (typeof body?.customer?.id !== "string") throw new Error("SQUARE_INVALID_RESPONSE");
      return { customerId: body.customer.id, ...(typeof body.customer.email_address === "string" ? { email: body.customer.email_address } : {}) };
    },
  }),
  node({
    id: "razorpay", name: "Razorpay", auth: { type: "apiKey", credentialKey: "keyId" },
    description: "Creates a Razorpay customer using the workspace key ID and secret. This does not create or capture a payment.",
    input: z.object({ name: z.string().trim().min(1).max(200), email: z.string().email(), contact: z.string().regex(/^\+?[1-9]\d{7,14}$/).optional() }).strict(),
    output: z.object({ customerId: z.string(), email: z.string().email() }).strict(),
    async run(ctx, input) {
      const auth = Buffer.from(secret(ctx, "razorpay", "keyId") + ":" + secret(ctx, "razorpay", "keySecret")).toString("base64");
      const body = await request(ctx, "razorpay", { url: "https://api.razorpay.com/v1/customers", method: "POST", headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" }, body: { name: input.name, email: input.email, ...(input.contact ? { contact: input.contact } : {}) } }) as Record<string, unknown>;
      if (typeof body?.id !== "string" || typeof body.email !== "string") throw new Error("RAZORPAY_INVALID_RESPONSE");
      return { customerId: body.id, email: body.email };
    },
  }),
  node({
    id: "zoom", name: "Zoom", auth: { type: "apiKey", credentialKey: "accessToken" },
    description: "Lists recent Zoom meetings for the connected user using a read-only access token.",
    input: z.object({ userId: z.string().trim().min(1).max(200).default("me"), pageSize: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ meetings: z.array(z.object({ id: z.number(), topic: z.string().optional(), startTime: z.string().optional(), joinUrl: z.string().url().optional() }).strict()).max(100) }).strict(),
    async run(ctx, input) {
      const url = new URL("https://api.zoom.us/v2/users/" + encodeURIComponent(input.userId ?? "me") + "/meetings");
      url.searchParams.set("page_size", String(input.pageSize ?? 20));
      const body = await request(ctx, "zoom", { url: url.toString(), headers: { Authorization: "Bearer " + secret(ctx, "zoom", "accessToken") } }) as Record<string, any>;
      const meetings = Array.isArray(body?.meetings) ? body.meetings.flatMap((m: any) => typeof m?.id === "number" ? [{ id: m.id, ...(typeof m.topic === "string" ? { topic: m.topic } : {}), ...(typeof m.start_time === "string" ? { startTime: m.start_time } : {}), ...(typeof m.join_url === "string" ? { joinUrl: m.join_url } : {}) }] : []) : [];
      return { meetings: meetings.slice(0, input.pageSize ?? 20) };
    },
  }),
  node({
    id: "cal_com", name: "Cal.com", auth: { type: "apiKey", credentialKey: "apiKey" },
    description: "Creates a Cal.com booking for a specified event type and attendee. This is an external scheduling action and requires explicit live-action approval.",
    input: z.object({ eventTypeId: z.number().int().positive(), start: z.string().datetime(), attendeeName: z.string().trim().min(1).max(200), attendeeEmail: z.string().email(), timeZone: z.string().min(1).max(100) }).strict(),
    output: z.object({ bookingUid: z.string(), status: z.string().optional() }).strict(),
    async run(ctx, input) {
      const body = await request(ctx, "cal_com", { url: "https://api.cal.com/v2/bookings", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "cal_com", "apiKey"), "cal-api-version": "2024-08-13", "Content-Type": "application/json" },
        body: { eventTypeId: input.eventTypeId, start: input.start, attendee: { name: input.attendeeName, email: input.attendeeEmail, timeZone: input.timeZone, language: "en" } } }) as Record<string, any>;
      const data = body?.data ?? body;
      if (typeof data?.uid !== "string") throw new Error("CAL_COM_INVALID_RESPONSE");
      return { bookingUid: data.uid, ...(typeof data.status === "string" ? { status: data.status } : {}) };
    },
  }),
  node({
    id: "twilio_voice", name: "Twilio Voice", auth: { type: "apiKey", credentialKey: "authToken" },
    description: "Initiates an outbound Twilio voice call to an E.164 number using a verified HTTPS TwiML URL. Live calls require explicit approval.",
    input: z.object({ to: z.string().regex(/^\+[1-9]\d{7,14}$/), twimlUrl: z.string().url() }).strict(),
    output: z.object({ callSid: z.string(), status: z.string().optional() }).strict(),
    async run(ctx, input) {
      const twiml = new URL(input.twimlUrl);
      if (twiml.protocol !== "https:" || twiml.username || twiml.password) throw new Error("TWILIO_VOICE_TWIML_URL_INVALID");
      const sid = secret(ctx, "twilio_voice", "accountSid"), authToken = secret(ctx, "twilio_voice", "authToken");
      const form = new URLSearchParams({ To: input.to, From: secret(ctx, "twilio_voice", "fromPhone"), Url: twiml.toString() }).toString();
      const body = await request(ctx, "twilio_voice", { url: "https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(sid) + "/Calls.json", method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(sid + ":" + authToken).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: form }) as Record<string, unknown>;
      if (typeof body?.sid !== "string") throw new Error("TWILIO_VOICE_INVALID_RESPONSE");
      return { callSid: body.sid, ...(typeof body.status === "string" ? { status: body.status } : {}) };
    },
  }),
  node({
    id: "docusign", name: "DocuSign", auth: { type: "apiKey", credentialKey: "accessToken" },
    description: "Lists DocuSign envelopes created since a specified date using a read-only account token; it does not send or sign documents.",
    input: z.object({ fromDate: z.string().datetime(), status: z.string().max(40).optional() }).strict(),
    output: z.object({ envelopes: z.array(z.object({ envelopeId: z.string(), status: z.string(), emailSubject: z.string().optional() }).strict()).max(100) }).strict(),
    async run(ctx, input) {
      const account = secret(ctx, "docusign", "accountId"), base = secret(ctx, "docusign", "baseUri");
      let origin: URL; try { origin = new URL(base); } catch { throw new Error("DOCUSIGN_CONNECTION_INVALID"); }
      if (origin.protocol !== "https:" || !origin.hostname.endsWith(".docusign.net") && !origin.hostname.endsWith(".docusign.com")) throw new Error("DOCUSIGN_CONNECTION_INVALID");
      const url = new URL(origin.origin + "/restapi/v2.1/accounts/" + encodeURIComponent(account) + "/envelopes");
      url.searchParams.set("from_date", input.fromDate); if (input.status) url.searchParams.set("status", input.status);
      const body = await request(ctx, "docusign", { url: url.toString(), headers: { Authorization: "Bearer " + secret(ctx, "docusign", "accessToken") } }) as Record<string, any>;
      const envelopes = Array.isArray(body?.envelopes) ? body.envelopes.flatMap((e: any) => typeof e?.envelopeId === "string" && typeof e?.status === "string" ? [{ envelopeId: e.envelopeId, status: e.status, ...(typeof e.emailSubject === "string" ? { emailSubject: e.emailSubject } : {}) }] : []) : [];
      return { envelopes: envelopes.slice(0, 100) };
    },
  }),
];
