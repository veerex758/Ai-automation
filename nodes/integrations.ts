import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

async function request(ctx: NodeContext, args: {
  url: string; method: "GET" | "POST"; headers?: Record<string, string>; body?: unknown;
}, code: string) {
  const response = await ctx.http.request({ ...args, timeoutMs: 15000, retries: 0 });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("Integration request failed", { provider: code, status: response.status });
    throw new Error(response.status === 429 ? code + "_RATE_LIMITED" : code + "_REQUEST_FAILED");
  }
  if (!response.body || typeof response.body !== "object") throw new Error(code + "_INVALID_RESPONSE");
  return response.body as Record<string, unknown>;
}

function required(ctx: NodeContext, provider: string, field: string, code: string) {
  const value = ctx.credentials[provider]?.[field];
  if (!value?.trim()) throw new Error(code + "_CONNECTION_REQUIRED");
  return value.trim();
}

const gmailInput = z.object({
  query: z.string().max(500).default(""),
  maxResults: z.number().int().min(1).max(50).default(10),
}).strict();
const gmailOutput = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string().optional() }).strict()),
  resultSizeEstimate: z.number().int().nonnegative().optional(),
}).strict();

export const gmailNode: NodeDefinition = {
  id: "gmail", name: "Gmail", icon: "mail", category: "communication", version: 1,
  auth: { type: "oauth2", scopes: ["https://www.googleapis.com/auth/gmail.readonly"], refresh: "managed" },
  triggers: [],
  actions: [{
    id: "list_messages", name: "List messages",
    description: "Lists Gmail message IDs matching a Gmail search query. Read-only; requires a connected Google account with the Gmail read-only scope.",
    inputSchema: gmailInput, outputSchema: gmailOutput,
    async run(ctx, raw) {
      const input = gmailInput.parse(raw);
      const token = required(ctx, "gmail", "accessToken", "GMAIL");
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      if (input.query) url.searchParams.set("q", input.query);
      url.searchParams.set("maxResults", String(input.maxResults));
      const body = await request(ctx, { url: url.toString(), method: "GET", headers: { Authorization: "Bearer " + token } }, "GMAIL");
      const messages = Array.isArray(body.messages) ? body.messages.flatMap((item) =>
        item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
          ? [{ id: (item as Record<string, string>).id, ...(typeof (item as Record<string, unknown>).threadId === "string" ? { threadId: (item as Record<string, string>).threadId } : {}) }]
          : []) : [];
      return gmailOutput.parse({ messages, ...(typeof body.resultSizeEstimate === "number" ? { resultSizeEstimate: body.resultSizeEstimate } : {}) });
    },
  }, {
    id: "get_message", name: "Get message",
    description: "Retrieves one Gmail message's metadata and selected headers by message ID using the connected read-only Gmail scope.",
    inputSchema: z.object({ messageId: z.string().trim().min(1).max(200) }).strict(),
    outputSchema: z.object({ id: z.string(), threadId: z.string().optional(), snippet: z.string().optional(), headers: z.record(z.string(), z.string()).default({}) }).strict(),
    async run(ctx, raw) {
      const input = z.object({ messageId: z.string().trim().min(1).max(200) }).strict().parse(raw);
      const token = required(ctx, "gmail", "accessToken", "GMAIL");
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(input.messageId));
      url.searchParams.set("format", "metadata");
      for (const header of ["Subject", "From", "To", "Date"]) url.searchParams.append("metadataHeaders", header);
      const body = await request(ctx, { url: url.toString(), method: "GET", headers: { Authorization: "Bearer " + token } }, "GMAIL");
      if (typeof body.id !== "string") throw new Error("GMAIL_INVALID_RESPONSE");
      const payload = body.payload as Record<string, unknown> | undefined;
      const rawHeaders = Array.isArray(payload?.headers) ? payload.headers : [];
      const headers = Object.fromEntries(rawHeaders.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return typeof row.name === "string" && typeof row.value === "string" ? [[row.name.toLowerCase(), row.value.slice(0, 2000)]] : [];
      }));
      return { id: body.id, ...(typeof body.threadId === "string" ? { threadId: body.threadId } : {}), ...(typeof body.snippet === "string" ? { snippet: body.snippet.slice(0, 5000) } : {}), headers };
    },
  }],
};

const sheetsInput = z.object({
  spreadsheetId: z.string().regex(/^[a-zA-Z0-9_-]{10,200}$/),
  range: z.string().trim().min(1).max(300),
}).strict();
const sheetsOutput = z.object({ range: z.string(), values: z.array(z.array(z.unknown())) }).strict();

export const sheetsNode: NodeDefinition = {
  id: "google_sheets", name: "Google Sheets", icon: "table", category: "data", version: 1,
  auth: { type: "oauth2", scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"], refresh: "managed" },
  triggers: [],
  actions: [{
    id: "get_values", name: "Get values",
    description: "Reads cell values from a Google spreadsheet range. Read-only; requires a connected Google account with the Sheets read-only scope.",
    inputSchema: sheetsInput, outputSchema: sheetsOutput,
    async run(ctx, raw) {
      const input = sheetsInput.parse(raw);
      const token = required(ctx, "sheets", "accessToken", "GOOGLE_SHEETS");
      const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(input.spreadsheetId) +
        "/values/" + encodeURIComponent(input.range);
      const body = await request(ctx, { url, method: "GET", headers: { Authorization: "Bearer " + token } }, "GOOGLE_SHEETS");
      return sheetsOutput.parse({ range: typeof body.range === "string" ? body.range : input.range, values: Array.isArray(body.values) ? body.values : [] });
    },
  }],
};

const notionInput = z.object({
  databaseId: z.string().regex(/^[a-f0-9-]{32,36}$/i),
  title: z.string().trim().min(1).max(200),
  titleProperty: z.string().trim().min(1).max(80).default("Name"),
}).strict();
const notionOutput = z.object({ pageId: z.string().min(1), url: z.string().url().optional() }).strict();
export const notionNode: NodeDefinition = {
  id: "notion", name: "Notion", icon: "notebook", category: "data", version: 1,
  auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [],
  actions: [{
    id: "create_page", name: "Create database page",
    description: "Creates a page in a Notion database shared with the connected integration. Requires the database ID and title property name.",
    inputSchema: notionInput, outputSchema: notionOutput,
    async run(ctx, raw) {
      const input = notionInput.parse(raw);
      const token = required(ctx, "notion", "apiKey", "NOTION");
      const body = await request(ctx, { url: "https://api.notion.com/v1/pages", method: "POST",
        headers: { Authorization: "Bearer " + token, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
        body: { parent: { database_id: input.databaseId }, properties: { [input.titleProperty]: { title: [{ text: { content: input.title } }] } } },
      }, "NOTION");
      if (typeof body.id !== "string") throw new Error("NOTION_INVALID_RESPONSE");
      return notionOutput.parse({ pageId: body.id, ...(typeof body.url === "string" ? { url: body.url } : {}) });
    },
  }],
};

const hubspotInput = z.object({
  email: z.string().email().max(254),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(40).optional(),
}).strict();
const hubspotOutput = z.object({ contactId: z.string().min(1) }).strict();
export const hubspotNode: NodeDefinition = {
  id: "hubspot", name: "HubSpot", icon: "contact", category: "communication", version: 1,
  auth: { type: "apiKey", credentialKey: "accessToken" }, triggers: [],
  actions: [{
    id: "create_contact", name: "Create contact",
    description: "Creates a HubSpot CRM contact using the connected private-app access token. Email is required; optional name and phone fields are supported.",
    inputSchema: hubspotInput, outputSchema: hubspotOutput,
    async run(ctx, raw) {
      const input = hubspotInput.parse(raw);
      const token = required(ctx, "hubspot", "accessToken", "HUBSPOT");
      const properties = Object.fromEntries(Object.entries({ email: input.email, firstname: input.firstName, lastname: input.lastName, phone: input.phone }).filter(([, value]) => value !== undefined));
      const body = await request(ctx, { url: "https://api.hubapi.com/crm/v3/objects/contacts", method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: { properties } }, "HUBSPOT");
      if (typeof body.id !== "string") throw new Error("HUBSPOT_INVALID_RESPONSE");
      return hubspotOutput.parse({ contactId: body.id });
    },
    {
      id: "search_contacts", name: "Search contacts",
      description: "Searches HubSpot contacts by exact email using the connected private-app token and returns bounded contact properties.",
      inputSchema: z.object({ email: z.string().email().max(254) }).strict(),
      outputSchema: z.object({ contacts: z.array(z.object({ contactId: z.string(), email: z.string().optional(), firstName: z.string().optional(), lastName: z.string().optional() }).strict()).max(20) }).strict(),
      async run(ctx, raw) {
        const input = z.object({ email: z.string().email().max(254) }).strict().parse(raw);
        const token = required(ctx, "hubspot", "accessToken", "HUBSPOT");
        const body = await request(ctx, { url: "https://api.hubapi.com/crm/v3/objects/contacts/search", method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: { filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: input.email }] }], properties: ["email", "firstname", "lastname"], limit: 20 } }, "HUBSPOT");
        const contacts = Array.isArray(body.results) ? body.results.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          const properties = row.properties as Record<string, unknown> | undefined;
          return typeof row.id === "string" ? [{ contactId: row.id,
            ...(typeof properties?.email === "string" ? { email: properties.email } : {}),
            ...(typeof properties?.firstname === "string" ? { firstName: properties.firstname } : {}),
            ...(typeof properties?.lastname === "string" ? { lastName: properties.lastname } : {}) }] : [];
        }) : [];
        return { contacts: contacts.slice(0, 20) };
      },
    },
  ],
};

const twilioInput = z.object({
  to: z.string().regex(/^\+[1-9]\d{7,14}$/),
  body: z.string().trim().min(1).max(1500),
}).strict();
const twilioOutput = z.object({ messageSid: z.string().min(1), status: z.string().optional() }).strict();
export const twilioNode: NodeDefinition = {
  id: "twilio", name: "Twilio", icon: "message-square", category: "communication", version: 1,
  auth: { type: "apiKey", credentialKey: "authToken" }, triggers: [],
  actions: [{
    id: "send_sms", name: "Send SMS",
    description: "Sends an SMS from the configured Twilio number. Requires an E.164 recipient and a server-side recipient allowlist before live execution.",
    inputSchema: twilioInput, outputSchema: twilioOutput,
    async run(ctx, raw) {
      const input = twilioInput.parse(raw);
      const sid = required(ctx, "twilio", "accountSid", "TWILIO");
      const token = required(ctx, "twilio", "authToken", "TWILIO");
      const from = required(ctx, "twilio", "fromPhone", "TWILIO");
      const form = new URLSearchParams({ To: input.to, From: from, Body: input.body }).toString();
      const auth = Buffer.from(sid + ":" + token).toString("base64");
      const body = await request(ctx, { url: "https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(sid) + "/Messages.json",
        method: "POST", headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" }, body: form }, "TWILIO");
      if (typeof body.sid !== "string") throw new Error("TWILIO_INVALID_RESPONSE");
      return twilioOutput.parse({ messageSid: body.sid, ...(typeof body.status === "string" ? { status: body.status } : {}) });
    },
  }],
};

const shopifyInput = z.object({ limit: z.number().int().min(1).max(50).default(10) }).strict();
const shopifyOutput = z.object({ products: z.array(z.object({ id: z.number(), title: z.string(), status: z.string().optional() }).strict()) }).strict();
export const shopifyNode: NodeDefinition = {
  id: "shopify", name: "Shopify", icon: "shopping-bag", category: "data", version: 1,
  auth: { type: "apiKey", credentialKey: "accessToken" }, triggers: [],
  actions: [{
    id: "list_products", name: "List products",
    description: "Lists products from the connected Shopify store. Read-only; requires a shop domain ending in myshopify.com and an Admin API access token.",
    inputSchema: shopifyInput, outputSchema: shopifyOutput,
    async run(ctx, raw) {
      const input = shopifyInput.parse(raw);
      const shop = required(ctx, "shopify", "shopDomain", "SHOPIFY");
      if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) throw new Error("SHOPIFY_CONNECTION_INVALID");
      const token = required(ctx, "shopify", "accessToken", "SHOPIFY");
      const body = await request(ctx, { url: "https://" + shop + "/admin/api/2025-10/products.json?limit=" + input.limit,
        method: "GET", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } }, "SHOPIFY");
      const products = Array.isArray(body.products) ? body.products.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const product = item as Record<string, unknown>;
        return typeof product.id === "number" && typeof product.title === "string"
          ? [{ id: product.id, title: product.title, ...(typeof product.status === "string" ? { status: product.status } : {}) }] : [];
      }) : [];
      return shopifyOutput.parse({ products });
    },
  }],
};

const stripeInput = z.object({
  email: z.string().email().max(254),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
}).strict();
const stripeOutput = z.object({ customerId: z.string().min(1), email: z.string().email().optional() }).strict();
export const stripeNode: NodeDefinition = {
  id: "stripe", name: "Stripe", icon: "credit-card", category: "data", version: 1,
  auth: { type: "apiKey", credentialKey: "secretKey" }, triggers: [],
  actions: [{
    id: "create_customer", name: "Create customer",
    description: "Creates a Stripe customer record; it does not create a charge, payment intent, or subscription. Requires a connected restricted or secret API key.",
    inputSchema: stripeInput, outputSchema: stripeOutput,
    async run(ctx, raw) {
      const input = stripeInput.parse(raw);
      const key = required(ctx, "stripe", "secretKey", "STRIPE");
      const form = new URLSearchParams({ email: input.email, ...(input.name ? { name: input.name } : {}), ...(input.description ? { description: input.description } : {}) }).toString();
      const body = await request(ctx, { url: "https://api.stripe.com/v1/customers", method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" }, body: form }, "STRIPE");
      if (typeof body.id !== "string") throw new Error("STRIPE_INVALID_RESPONSE");
      return stripeOutput.parse({ customerId: body.id, ...(typeof body.email === "string" ? { email: body.email } : {}) });
    },
  }],
};

const linearInput = z.object({
  teamId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(250),
  description: z.string().max(10000).optional(),
}).strict();
const linearOutput = z.object({ issueId: z.string().min(1), identifier: z.string().optional(), url: z.string().url().optional() }).strict();
export const linearNode: NodeDefinition = {
  id: "linear", name: "Linear", icon: "workflow", category: "data", version: 1,
  auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [],
  actions: [{
    id: "create_issue", name: "Create issue",
    description: "Creates an issue in the specified Linear team using the connected API key. Returns the issue ID, identifier, and URL.",
    inputSchema: linearInput, outputSchema: linearOutput,
    async run(ctx, raw) {
      const input = linearInput.parse(raw);
      const token = required(ctx, "linear", "apiKey", "LINEAR");
      const body = await request(ctx, { url: "https://api.linear.app/graphql", method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: { query: "mutation CreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }",
          variables: { input: { teamId: input.teamId, title: input.title, ...(input.description ? { description: input.description } : {}) } } },
      }, "LINEAR");
      const data = body.data as { issueCreate?: { success?: unknown; issue?: { id?: unknown; identifier?: unknown; url?: unknown } } } | undefined;
      if (!data?.issueCreate?.success || typeof data.issueCreate.issue?.id !== "string") throw new Error("LINEAR_INVALID_RESPONSE");
      const issue = data.issueCreate.issue;
      return linearOutput.parse({ issueId: issue.id, ...(typeof issue.identifier === "string" ? { identifier: issue.identifier } : {}), ...(typeof issue.url === "string" ? { url: issue.url } : {}) });
    },
  }],
};
