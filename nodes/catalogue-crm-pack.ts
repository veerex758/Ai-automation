/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import type { NodeContext, NodeDefinition } from "./types";

type ProviderId = "microsoft_teams" | "salesforce" | "pipedrive" | "zoho_crm" | "freshsales" | "close" | "apollo" | "intercom";

function secret(ctx: NodeContext, provider: ProviderId, field: string): string {
  const value = ctx.credentials[provider]?.[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value.trim();
}

async function call(ctx: NodeContext, provider: ProviderId, args: {
  url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown;
}): Promise<Record<string, unknown>> {
  const response = await ctx.http.request({
    url: args.url, method: args.method ?? "GET", headers: args.headers,
    ...(args.body === undefined ? {} : { body: args.body }), timeoutMs: 15000, retries: 0,
  });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("CRM provider operation failed", { provider, status: response.status });
    throw new Error(response.status === 429 ? provider.toUpperCase() + "_RATE_LIMITED" : provider.toUpperCase() + "_REQUEST_FAILED");
  }
  if (!response.body || typeof response.body !== "object" || Array.isArray(response.body)) throw new Error(provider.toUpperCase() + "_INVALID_RESPONSE");
  return response.body as Record<string, unknown>;
}

function node<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(args: {
  id: ProviderId; name: string; description: string; input: I; output: O;
  auth?: NodeDefinition["auth"];
  run(ctx: NodeContext, input: z.infer<I>): Promise<unknown>;
  additionalActions?: NodeDefinition["actions"];
}): NodeDefinition {
  return {
    id: args.id, name: args.name, icon: "plug", category: args.id === "microsoft_teams" ? "communication" : "data", version: 1,
    auth: args.auth ?? { type: "oauth2", scopes: ["provider.api"], refresh: "manual" }, triggers: [],
    actions: [{
      id: "execute", name: args.name + " action", description: args.description,
      inputSchema: args.input, outputSchema: args.output,
      async run(ctx, raw) {
        const input = args.input.parse(raw);
        return args.output.parse(await args.run(ctx, input));
      },
    }, ...(args.additionalActions ?? [])],
  };
}

const contactInput = z.object({
  email: z.string().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().max(40).optional(),
}).strict();
const contactOutput = z.object({ contactId: z.string().min(1) }).strict();
const searchContactsOutput = z.object({ contacts: z.array(z.object({ contactId: z.string(), email: z.string().optional(), firstName: z.string().optional(), lastName: z.string().optional() }).strict()).max(20) }).strict();

export const catalogueCrmNodes: NodeDefinition[] = [
  node({
    id: "microsoft_teams", name: "Microsoft Teams",
    description: "Posts a text message to a specified Microsoft Teams chat using a workspace Microsoft Graph access token.",
    input: z.object({ chatId: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(4000) }).strict(),
    output: z.object({ messageId: z.string(), chatId: z.string() }).strict(),
    async run(ctx, input) {
      const token = secret(ctx, "microsoft_teams", "accessToken");
      const body = await call(ctx, "microsoft_teams", {
        url: "https://graph.microsoft.com/v1.0/chats/" + encodeURIComponent(input.chatId) + "/messages",
        method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: { body: { contentType: "text", content: input.content } },
      });
      if (typeof body.id !== "string") throw new Error("MICROSOFT_TEAMS_INVALID_RESPONSE");
      return { messageId: body.id, chatId: input.chatId };
    },
  }),
  node({
    id: "salesforce", name: "Salesforce",
    description: "Creates a Salesforce Lead with validated name, email and optional phone fields using a manually connected OAuth access token.",
    input: z.object({ firstName: z.string().max(40).optional(), lastName: z.string().trim().min(1).max(80), company: z.string().trim().min(1).max(255), email: z.string().email().optional(), phone: z.string().max(40).optional() }).strict(),
    output: z.object({ leadId: z.string(), success: z.boolean() }).strict(),
    async run(ctx, input) {
      const token = secret(ctx, "salesforce", "accessToken");
      const instance = secret(ctx, "salesforce", "instanceUrl");
      let url: URL;
      try { url = new URL(instance); } catch { throw new Error("SALESFORCE_CONNECTION_INVALID"); }
      if (url.protocol !== "https:" || url.username || url.password || !(url.hostname.endsWith(".salesforce.com") || url.hostname.endsWith(".force.com"))) throw new Error("SALESFORCE_CONNECTION_INVALID");
      const body = await call(ctx, "salesforce", {
        url: url.origin + "/services/data/v60.0/sobjects/Lead/", method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: { LastName: input.lastName, Company: input.company, ...(input.firstName ? { FirstName: input.firstName } : {}), ...(input.email ? { Email: input.email } : {}), ...(input.phone ? { Phone: input.phone } : {}) },
      });
      if (typeof body.id !== "string" || body.success !== true) throw new Error("SALESFORCE_INVALID_RESPONSE");
      return { leadId: body.id, success: true };
    },
    additionalActions: [{
      id: "search_contacts", name: "Search leads by email",
      description: "Searches Salesforce Leads for an exact email match using SOQL and the connected API-scoped OAuth token.",
      inputSchema: z.object({ email: z.string().email().max(254) }).strict(), outputSchema: searchContactsOutput,
      async run(ctx, raw) {
        const input = z.object({ email: z.string().email().max(254) }).strict().parse(raw);
        const token = secret(ctx, "salesforce", "accessToken"), instance = secret(ctx, "salesforce", "instanceUrl");
        let base: URL; try { base = new URL(instance); } catch { throw new Error("SALESFORCE_CONNECTION_INVALID"); }
        if (base.protocol !== "https:" || base.username || base.password || !(base.hostname.endsWith(".salesforce.com") || base.hostname.endsWith(".force.com"))) throw new Error("SALESFORCE_CONNECTION_INVALID");
        const email = input.email.replace(/\\/g, "\\\\").replace(/'/g, "\\\\'");
        const query = "SELECT Id,FirstName,LastName,Email FROM Lead WHERE Email = '" + email + "' LIMIT 20";
        const body = await call(ctx, "salesforce", { url: base.origin + "/services/data/v60.0/query?q=" + encodeURIComponent(query), headers: { Authorization: "Bearer " + token } });
        const contacts = Array.isArray(body.records) ? body.records.flatMap((item: any) => typeof item?.Id === "string" ? [{ contactId: item.Id, ...(typeof item.Email === "string" ? { email: item.Email } : {}), ...(typeof item.FirstName === "string" ? { firstName: item.FirstName } : {}), ...(typeof item.LastName === "string" ? { lastName: item.LastName } : {}) }] : []) : [];
        return { contacts: contacts.slice(0, 20) };
      },
    }],
  }),
  node({
    id: "pipedrive", name: "Pipedrive",
    description: "Creates a Pipedrive person using the connected OAuth access token and returns the person ID.",
    input: contactInput,
    output: contactOutput,
    async run(ctx, input) {
      const token = secret(ctx, "pipedrive", "accessToken");
      const body = await call(ctx, "pipedrive", { url: "https://api.pipedrive.com/v1/persons", method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: { name: [input.firstName, input.lastName].join(" "), email: [{ value: input.email, primary: true }], ...(input.phone ? { phone: [{ value: input.phone, primary: true }] } : {}) } });
      const data = body.data as Record<string, unknown> | undefined;
      if (typeof data?.id !== "number" && typeof data?.id !== "string") throw new Error("PIPEDRIVE_INVALID_RESPONSE");
      return { contactId: String(data.id) };
    },
    additionalActions: [{
      id: "search_contacts", name: "Search persons by email",
      description: "Searches Pipedrive persons by email using the connected OAuth token and returns bounded contact fields.",
      inputSchema: z.object({ email: z.string().email().max(254) }).strict(), outputSchema: searchContactsOutput,
      async run(ctx, raw) {
        const input = z.object({ email: z.string().email().max(254) }).strict().parse(raw);
        const token = secret(ctx, "pipedrive", "accessToken");
        const url = new URL("https://api.pipedrive.com/v1/persons/search");
        url.searchParams.set("term", input.email); url.searchParams.set("fields", "email"); url.searchParams.set("exact_match", "true"); url.searchParams.set("limit", "20");
        const body = await call(ctx, "pipedrive", { url: url.toString(), headers: { Authorization: "Bearer " + token } });
        const data = body.data as any;
        const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        const contacts = items.flatMap((entry: any) => {
          const row = entry?.item ?? entry;
          if (typeof row?.id !== "number" && typeof row?.id !== "string") return [];
          const emails = Array.isArray(row.email) ? row.email : [];
          const emailValue = emails.find((value: any) => typeof value?.value === "string")?.value;
          const names = typeof row.name === "string" ? row.name.split(/\s+/, 2) : [];
          return [{ contactId: String(row.id), ...(typeof emailValue === "string" ? { email: emailValue } : {}), ...(names[0] ? { firstName: names[0] } : {}), ...(names[1] ? { lastName: names[1] } : {}) }];
        });
        return { contacts: contacts.slice(0, 20) };
      },
    }],
  }),
  node({
    id: "zoho_crm", name: "Zoho CRM",
    description: "Creates a Zoho CRM Contact using the connected OAuth access token and returns the provider record ID.",
    input: contactInput,
    output: contactOutput,
    async run(ctx, input) {
      const token = secret(ctx, "zoho_crm", "accessToken");
      const body = await call(ctx, "zoho_crm", { url: "https://www.zohoapis.com/crm/v6/Contacts", method: "POST",
        headers: { Authorization: "Zoho-oauthtoken " + token, "Content-Type": "application/json" },
        body: { data: [{ First_Name: input.firstName, Last_Name: input.lastName, Email: input.email, ...(input.phone ? { Phone: input.phone } : {}) }] } });
      const row = (body.data as any[] | undefined)?.[0];
      const details = row?.details as Record<string, unknown> | undefined;
      if (row?.status !== "success" || typeof details?.id !== "string") throw new Error("ZOHO_CRM_INVALID_RESPONSE");
      return { contactId: details.id };
    },
    additionalActions: [{
      id: "search_contacts", name: "Search contacts by email",
      description: "Searches Zoho CRM Contacts by exact email using the connected OAuth access token.",
      inputSchema: z.object({ email: z.string().email().max(254) }).strict(), outputSchema: searchContactsOutput,
      async run(ctx, raw) {
        const input = z.object({ email: z.string().email().max(254) }).strict().parse(raw);
        const token = secret(ctx, "zoho_crm", "accessToken");
        const url = new URL("https://www.zohoapis.com/crm/v6/Contacts/search"); url.searchParams.set("email", input.email);
        const body = await call(ctx, "zoho_crm", { url: url.toString(), headers: { Authorization: "Zoho-oauthtoken " + token } });
        const contacts = Array.isArray(body.data) ? body.data.flatMap((row: any) => typeof row?.id === "string" ? [{ contactId: row.id, ...(typeof row.Email === "string" ? { email: row.Email } : {}), ...(typeof row.First_Name === "string" ? { firstName: row.First_Name } : {}), ...(typeof row.Last_Name === "string" ? { lastName: row.Last_Name } : {}) }] : []) : [];
        return { contacts: contacts.slice(0, 20) };
      },
    }],
  }),
  node({
    id: "freshsales", name: "Freshsales",
    description: "Creates a Freshsales contact using the workspace access token and validated Freshsales account domain.",
    input: contactInput,
    output: contactOutput,
    async run(ctx, input) {
      const token = secret(ctx, "freshsales", "accessToken");
      const domain = secret(ctx, "freshsales", "domain");
      if (!/^[a-z0-9-]+\.myfreshworks\.com$/i.test(domain)) throw new Error("FRESHSALES_CONNECTION_INVALID");
      const body = await call(ctx, "freshsales", { url: "https://" + domain + "/crm/sales/api/contacts", method: "POST",
        headers: { Authorization: "Token token=" + token, "Content-Type": "application/json" },
        body: { contact: { email: input.email, first_name: input.firstName, last_name: input.lastName, ...(input.phone ? { mobile_number: input.phone } : {}) } } });
      const contact = body.contact as Record<string, unknown> | undefined;
      if (typeof contact?.id !== "number" && typeof contact?.id !== "string") throw new Error("FRESHSALES_INVALID_RESPONSE");
      return { contactId: String(contact.id) };
    },
    additionalActions: [{
      id: "search_contacts", name: "Search contacts by email",
      description: "Looks up Freshsales contacts by exact email through the account lookup API.",
      inputSchema: z.object({ email: z.string().email().max(254) }).strict(), outputSchema: searchContactsOutput,
      async run(ctx, raw) {
        const input = z.object({ email: z.string().email().max(254) }).strict().parse(raw);
        const token = secret(ctx, "freshsales", "accessToken"), domain = secret(ctx, "freshsales", "domain");
        if (!/^[a-z0-9-]+\\.myfreshworks\\.com$/i.test(domain)) throw new Error("FRESHSALES_CONNECTION_INVALID");
        const url = new URL("https://" + domain + "/crm/sales/api/lookup");
        url.searchParams.set("q", input.email); url.searchParams.set("f", "email"); url.searchParams.set("entities", "contact");
        const body = await call(ctx, "freshsales", { url: url.toString(), headers: { Authorization: "Token token=" + token } });
        const contacts = Array.isArray(body.contacts) ? body.contacts.flatMap((row: any) => typeof row?.id === "number" || typeof row?.id === "string" ? [{ contactId: String(row.id), ...(typeof row.email === "string" ? { email: row.email } : {}), ...(typeof row.name === "string" ? { firstName: row.name.trim().split(/\s+/, 2)[0], ...(row.name.trim().split(/\s+/, 2)[1] ? { lastName: row.name.trim().split(/\s+/, 2)[1] } : {}) } : {}) }] : []) : [];
        return { contacts: contacts.slice(0, 20) };
      },
    }],
  }),
  node({
    id: "close", name: "Close",
    description: "Creates a Close CRM lead with one contact email using the workspace API key.",
    auth: { type: "apiKey", credentialKey: "apiKey" },
    input: z.object({ name: z.string().trim().min(1).max(200), email: z.string().email().max(254) }).strict(),
    output: contactOutput,
    async run(ctx, input) {
      const key = secret(ctx, "close", "apiKey");
      const body = await call(ctx, "close", { url: "https://api.close.com/api/v1/lead/", method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(key + ":").toString("base64"), "Content-Type": "application/json" },
        body: { name: input.name, contacts: [{ emails: [{ email: input.email, type: "work" }] }] } });
      if (typeof body.id !== "string") throw new Error("CLOSE_INVALID_RESPONSE");
      return { contactId: body.id };
    },
    additionalActions: [{
      id: "search_contacts", name: "Search contacts by email",
      description: "Searches Intercom contacts for an exact email match using the connected OAuth token.",
      inputSchema: z.object({ email: z.string().email().max(254) }).strict(), outputSchema: searchContactsOutput,
      async run(ctx, raw) {
        const input = z.object({ email: z.string().email().max(254) }).strict().parse(raw);
        const token = secret(ctx, "intercom", "accessToken");
        const body = await call(ctx, "intercom", { url: "https://api.intercom.io/contacts/search", method: "POST",
          headers: { Authorization: "Bearer " + token, "Intercom-Version": "2.11", "Content-Type": "application/json" },
          body: { query: { field: "email", operator: "=", value: input.email }, pagination: { per_page: 20 } } });
        const contacts = Array.isArray(body.data) ? body.data.flatMap((row: any) => typeof row?.id === "string" ? [{ contactId: row.id, ...(typeof row.email === "string" ? { email: row.email } : {}), ...(typeof row.name === "string" ? { firstName: row.name } : {}) }] : []) : [];
        return { contacts: contacts.slice(0, 20) };
      },
    }],
  }),
  node({
    id: "apollo", name: "Apollo",
    description: "Creates an Apollo contact using the workspace API key and returns the created contact ID.",
    auth: { type: "apiKey", credentialKey: "apiKey" },
    input: contactInput,
    output: contactOutput,
    async run(ctx, input) {
      const key = secret(ctx, "apollo", "apiKey");
      const body = await call(ctx, "apollo", { url: "https://api.apollo.io/api/v1/contacts", method: "POST",
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        body: { first_name: input.firstName, last_name: input.lastName, email: input.email, ...(input.phone ? { phone_number: input.phone } : {}) } });
      const contact = (body.contact ?? body.person) as Record<string, unknown> | undefined;
      if (typeof contact?.id !== "string") throw new Error("APOLLO_INVALID_RESPONSE");
      return { contactId: contact.id };
    },
    additionalActions: [{
      id: "search_contacts", name: "Search saved contacts",
      description: "Searches contacts already saved in the connected Apollo workspace by email keyword; does not run prospect discovery or consume enrichment credits.",
      inputSchema: z.object({ email: z.string().email().max(254) }).strict(), outputSchema: searchContactsOutput,
      async run(ctx, raw) {
        const input = z.object({ email: z.string().email().max(254) }).strict().parse(raw);
        const key = secret(ctx, "apollo", "apiKey");
        const body = await call(ctx, "apollo", { url: "https://api.apollo.io/api/v1/contacts/search", method: "POST",
          headers: { "x-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
          body: { q_keywords: input.email, page: 1, per_page: 20 } });
        const rows = Array.isArray(body.contacts) ? body.contacts : [];
        const contacts = rows.flatMap((row: any) => typeof row?.id === "string" ? [{ contactId: row.id, ...(typeof row.email === "string" ? { email: row.email } : {}), ...(typeof row.first_name === "string" ? { firstName: row.first_name } : {}), ...(typeof row.last_name === "string" ? { lastName: row.last_name } : {}) }] : []);
        return { contacts: contacts.slice(0, 20) };
      },
    }],
  }),
  node({
    id: "intercom", name: "Intercom",
    description: "Creates an Intercom contact using the connected OAuth access token and returns the contact ID.",
    input: z.object({ email: z.string().email().max(254), name: z.string().trim().min(1).max(200) }).strict(),
    output: contactOutput,
    async run(ctx, input) {
      const token = secret(ctx, "intercom", "accessToken");
      const body = await call(ctx, "intercom", { url: "https://api.intercom.io/contacts", method: "POST",
        headers: { Authorization: "Bearer " + token, "Intercom-Version": "2.11", "Content-Type": "application/json" },
        body: { role: "user", email: input.email, name: input.name } });
      if (typeof body.id !== "string") throw new Error("INTERCOM_INVALID_RESPONSE");
      return { contactId: body.id };
    },
  }),
];
