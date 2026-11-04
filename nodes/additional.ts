import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

const text = (max = 4000) => z.string().trim().min(1).max(max);
const resultSchema = z.object({ status: z.number().int(), result: z.unknown().optional() }).passthrough();
function token(ctx: NodeContext, provider: string, key = "accessToken") {
  const value = ctx.credentials[provider]?.[key];
  if (!value) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value;
}
function jsonHeaders(value: string) { return { Authorization: "Bearer " + value, "Content-Type": "application/json" }; }
function assertOk(status: number, provider: string) {
  if (status < 200 || status >= 300) throw new Error(provider.toUpperCase() + (status === 429 ? "_RATE_LIMITED" : "_REQUEST_FAILED"));
}

export const googleSheetsNode: NodeDefinition = {
  id: "google_sheets", name: "Google Sheets", icon: "table", category: "data", version: 1,
  auth: { type: "oauth2", scopes: ["https://www.googleapis.com/auth/spreadsheets"], refresh: "managed" },
  triggers: [], actions: [{
    id: "append_rows", name: "Append rows", description: "Appends rows to a Google spreadsheet using a connected Google account. spreadsheetId identifies the target spreadsheet, range is an A1 notation range such as Sheet1!A1, and values is a two-dimensional array of cell values. Writes data to the connected spreadsheet.",
    inputSchema: z.object({ spreadsheetId: text(200), range: text(300), values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).min(1)).min(1).max(500) }).strict(),
    outputSchema: z.object({ updatedRange: z.string(), updatedRows: z.number().int().nonnegative() }).strict(),
    async run(ctx, raw) {
      const i = thisInputGoogle.parse(raw); const t = token(ctx, "google");
      const r = await ctx.http.request({ url: "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(i.spreadsheetId) + "/values/" + encodeURIComponent(i.range) + ":append?valueInputOption=USER_ENTERED", method: "POST", headers: jsonHeaders(t), body: { values: i.values }, timeoutMs: 15000, retries: 0 });
      assertOk(r.status, "google_sheets");
      const b = r.body as { updates?: { updatedRange?: string; updatedRows?: number } };
      return { updatedRange: b.updates?.updatedRange ?? i.range, updatedRows: b.updates?.updatedRows ?? i.values.length };
    },
  }],
};
const thisInputGoogle = z.object({ spreadsheetId: text(200), range: text(300), values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).min(1)).min(1).max(500) }).strict();

export const gmailNode: NodeDefinition = {
  id: "gmail", name: "Gmail", icon: "mail", category: "communication", version: 1,
  auth: { type: "oauth2", scopes: ["https://www.googleapis.com/auth/gmail.send"], refresh: "managed" },
  triggers: [], actions: [{
    id: "send_email", name: "Send email", description: "Sends an email from the connected Gmail account. to, subject and body are required. The message is encoded as RFC 2822 MIME and sent through Gmail API. This is an external side effect.",
    inputSchema: z.object({ to: z.string().email().max(254), subject: text(200), body: text(10000) }).strict(),
    outputSchema: z.object({ messageId: z.string(), threadId: z.string().optional() }).strict(),
    async run(ctx, raw) {
      const i = z.object({ to: z.string().email().max(254), subject: text(200), body: text(10000) }).strict().parse(raw);
      const mime = ["To: " + i.to, "Subject: " + i.subject, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", i.body].join("\r\n");
      const encoded = btoa(unescape(encodeURIComponent(mime))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const r = await ctx.http.request({ url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", method: "POST", headers: jsonHeaders(token(ctx, "google")), body: { raw: encoded }, timeoutMs: 15000, retries: 0 });
      assertOk(r.status, "gmail");
      const b = r.body as { id?: string; threadId?: string };
      if (!b.id) throw new Error("GMAIL_INVALID_RESPONSE");
      return { messageId: b.id, threadId: b.threadId };
    },
  }],
};

export const notionNode: NodeDefinition = {
  id: "notion", name: "Notion", icon: "book-open", category: "data", version: 1,
  auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{
    id: "create_page", name: "Create page", description: "Creates a Notion page under a connected parent page or database. parentId is the parent page or database ID; title is the new page title. Requires the integration to have access to the parent.",
    inputSchema: z.object({ parentId: z.string().uuid(), title: text(200) }).strict(),
    outputSchema: z.object({ pageId: z.string(), url: z.string().url() }).strict(),
    async run(ctx, raw) {
      const i = z.object({ parentId: z.string().uuid(), title: text(200) }).strict().parse(raw);
      const r = await ctx.http.request({ url: "https://api.notion.com/v1/pages", method: "POST", headers: { ...jsonHeaders(token(ctx, "notion", "apiKey")), "Notion-Version": "2022-06-28" }, body: { parent: { page_id: i.parentId }, properties: { title: { title: [{ text: { content: i.title } }] } } }, timeoutMs: 15000, retries: 0 });
      assertOk(r.status, "notion");
      const b = r.body as { id?: string; url?: string };
      if (!b.id || !b.url) throw new Error("NOTION_INVALID_RESPONSE");
      return { pageId: b.id, url: b.url };
    },
  }],
};

export const discordNode: NodeDefinition = {
  id: "discord", name: "Discord", icon: "message-circle", category: "communication", version: 1,
  auth: { type: "apiKey", credentialKey: "botToken" }, triggers: [], actions: [{
    id: "send_message", name: "Send channel message", description: "Sends a message to a Discord channel using a bot token. channelId must be a channel the bot can access. External side effect; Discord rate limits are surfaced as errors.",
    inputSchema: z.object({ channelId: z.string().regex(/^\d{5,25}$/), message: text(1900) }).strict(),
    outputSchema: z.object({ messageId: z.string(), channelId: z.string() }).strict(),
    async run(ctx, raw) {
      const i = z.object({ channelId: z.string().regex(/^\d{5,25}$/), message: text(1900) }).strict().parse(raw);
      const r = await ctx.http.request({ url: "https://discord.com/api/v10/channels/" + i.channelId + "/messages", method: "POST", headers: { ...jsonHeaders(token(ctx, "discord", "botToken")), Authorization: "Bot " + token(ctx, "discord", "botToken") }, body: { content: i.message }, timeoutMs: 12000, retries: 0 });
      assertOk(r.status, "discord");
      const b = r.body as { id?: string; channel_id?: string };
      if (!b.id) throw new Error("DISCORD_INVALID_RESPONSE");
      return { messageId: b.id, channelId: b.channel_id ?? i.channelId };
    },
  }],
};

export const telegramNode: NodeDefinition = {
  id: "telegram", name: "Telegram", icon: "send", category: "communication", version: 1,
  auth: { type: "apiKey", credentialKey: "botToken" }, triggers: [], actions: [{
    id: "send_message", name: "Send message", description: "Sends a text message through a connected Telegram bot. chatId can be a numeric chat ID or channel username. The bot must already have permission to message the destination.",
    inputSchema: z.object({ chatId: text(100), message: text(4000) }).strict(),
    outputSchema: z.object({ messageId: z.number().int(), chatId: z.union([z.string(), z.number()]) }).strict(),
    async run(ctx, raw) {
      const i = z.object({ chatId: text(100), message: text(4000) }).strict().parse(raw);
      const r = await ctx.http.request({ url: "https://api.telegram.org/bot" + token(ctx, "telegram", "botToken") + "/sendMessage", method: "POST", headers: { "Content-Type": "application/json" }, body: { chat_id: i.chatId, text: i.message }, timeoutMs: 12000, retries: 0 });
      assertOk(r.status, "telegram");
      const b = r.body as { ok?: boolean; result?: { message_id?: number; chat?: { id?: number } } };
      if (!b.ok || typeof b.result?.message_id !== "number") throw new Error("TELEGRAM_INVALID_RESPONSE");
      return { messageId: b.result.message_id, chatId: b.result.chat?.id ?? i.chatId };
    },
  }],
};

export const airtableNode: NodeDefinition = {
  id: "airtable", name: "Airtable", icon: "grid-3x3", category: "data", version: 1,
  auth: { type: "apiKey", credentialKey: "accessToken" }, triggers: [], actions: [{
    id: "create_record", name: "Create record", description: "Creates a record in an Airtable base and table using a connected personal access token. baseId and tableName select the destination; fields contains the record fields. The token must have data.records:write permission.",
    inputSchema: z.object({ baseId: text(100), tableName: text(100), fields: z.record(z.string(), z.unknown()) }).strict(),
    outputSchema: z.object({ recordId: z.string(), createdTime: z.string().optional() }).strict(),
    async run(ctx, raw) {
      const i = z.object({ baseId: text(100), tableName: text(100), fields: z.record(z.string(), z.unknown()) }).strict().parse(raw);
      const r = await ctx.http.request({ url: "https://api.airtable.com/v0/" + encodeURIComponent(i.baseId) + "/" + encodeURIComponent(i.tableName), method: "POST", headers: jsonHeaders(token(ctx, "airtable", "accessToken")), body: { fields: i.fields }, timeoutMs: 15000, retries: 0 });
      assertOk(r.status, "airtable");
      const b = r.body as { id?: string; createdTime?: string };
      if (!b.id) throw new Error("AIRTABLE_INVALID_RESPONSE");
      return { recordId: b.id, createdTime: b.createdTime };
    },
  }],
};

export const hubspotNode: NodeDefinition = {
  id: "hubspot", name: "HubSpot", icon: "users", category: "data", version: 1,
  auth: { type: "oauth2", scopes: ["crm.objects.contacts.write"], refresh: "managed" }, triggers: [], actions: [{
    id: "create_contact", name: "Create contact", description: "Creates a contact in the connected HubSpot CRM portal. email is required; firstName and lastName are optional. The connected app needs CRM contacts write permission. Duplicate email conflicts are returned as errors rather than silently creating duplicates.",
    inputSchema: z.object({ email: z.string().email(), firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional() }).strict(),
    outputSchema: z.object({ contactId: z.string() }).strict(),
    async run(ctx, raw) {
      const i = z.object({ email: z.string().email(), firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional() }).strict().parse(raw);
      const properties: Record<string, string> = { email: i.email };
      if (i.firstName) properties.firstname = i.firstName;
      if (i.lastName) properties.lastname = i.lastName;
      const r = await ctx.http.request({ url: "https://api.hubapi.com/crm/v3/objects/contacts", method: "POST", headers: jsonHeaders(token(ctx, "hubspot")), body: { properties }, timeoutMs: 15000, retries: 0 });
      assertOk(r.status, "hubspot");
      const b = r.body as { id?: string };
      if (!b.id) throw new Error("HUBSPOT_INVALID_RESPONSE");
      return { contactId: b.id };
    },
  }],
};

export const trelloNode: NodeDefinition = {
  id: "trello", name: "Trello", icon: "kanban", category: "data", version: 1,
  auth: { type: "apiKey", credentialKey: "token" }, triggers: [], actions: [{
    id: "create_card", name: "Create card", description: "Creates a Trello card on a selected list. listId and name are required; description is optional. Uses a connected Trello API key and token stored server-side. This creates a real card.",
    inputSchema: z.object({ listId: text(100), name: text(200), description: z.string().max(10000).optional() }).strict(),
    outputSchema: z.object({ cardId: z.string(), url: z.string().url() }).strict(),
    async run(ctx, raw) {
      const i = z.object({ listId: text(100), name: text(200), description: z.string().max(10000).optional() }).strict().parse(raw);
      const key = token(ctx, "trello", "apiKey"); const t = token(ctx, "trello", "token");
      const r = await ctx.http.request({ url: "https://api.trello.com/1/cards?key=" + encodeURIComponent(key) + "&token=" + encodeURIComponent(t), method: "POST", headers: { "Content-Type": "application/json" }, body: { idList: i.listId, name: i.name, desc: i.description ?? "" }, timeoutMs: 15000, retries: 0 });
      assertOk(r.status, "trello");
      const b = r.body as { id?: string; url?: string };
      if (!b.id || !b.url) throw new Error("TRELLO_INVALID_RESPONSE");
      return { cardId: b.id, url: b.url };
    },
  }],
};

export const httpRequestNode: NodeDefinition = {
  id: "http_request", name: "HTTP Request", icon: "globe", category: "developer", version: 1,
  auth: { type: "none" }, triggers: [], actions: [{
    id: "request", name: "Send HTTP request", description: "Makes a controlled HTTPS GET or POST request to an external API. Only public DNS hostnames are accepted; localhost, private, loopback, link-local and literal IP destinations are rejected. Do not place secrets in URLs; use headers. Runtime egress controls must also block private and metadata IP ranges after DNS resolution.",
    inputSchema: z.object({ url: z.string().url().max(2000), method: z.enum(["GET", "POST"]).default("GET"), headers: z.record(z.string(), z.string()).optional(), body: z.unknown().optional() }).strict(),
    outputSchema: z.object({ status: z.number().int(), body: z.unknown() }).strict(),
    async run(ctx, raw) {
      const i = z.object({ url: z.string().url().max(2000), method: z.enum(["GET", "POST"]).default("GET"), headers: z.record(z.string(), z.string()).optional(), body: z.unknown().optional() }).strict().parse(raw);
      const u = new URL(i.url);
      const host = u.hostname.toLowerCase();
      if (u.protocol !== "https:" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) throw new Error("HTTP_DESTINATION_NOT_ALLOWED");
      const r = await ctx.http.request({ url: u.toString(), method: i.method, headers: i.headers, body: i.method === "POST" ? i.body : undefined, timeoutMs: 15000, retries: 0 });
      return { status: r.status, body: r.body };
    },
  }],
};

export const dateTimeNode: NodeDefinition = {
  id: "date_time", name: "Date & Time", icon: "calendar-clock", category: "data", version: 1,
  auth: { type: "none" }, triggers: [], actions: [{
    id: "current_time", name: "Get current date and time", description: "Returns the current timestamp and a localized date/time string. timezone must be a valid IANA timezone such as Africa/Lagos or UTC. Useful for time-based messages, reports and date calculations; no external service or credential is required.",
    inputSchema: z.object({ timezone: z.string().default("UTC") }).strict(),
    outputSchema: z.object({ iso: z.string().datetime(), local: z.string(), timezone: z.string() }).strict(),
    async run(_ctx, raw) {
      const i = z.object({ timezone: z.string().default("UTC") }).strict().parse(raw);
      const now = new Date();
      try { new Intl.DateTimeFormat("en", { timeZone: i.timezone }).format(now); } catch { throw new Error("DATE_TIME_INVALID_TIMEZONE"); }
      return { iso: now.toISOString(), local: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: i.timezone }).format(now), timezone: i.timezone };
    },
  }],
};

export const additionalNodes: NodeDefinition[] = [
  googleSheetsNode, gmailNode, notionNode, discordNode, telegramNode,
  airtableNode, hubspotNode, trelloNode, httpRequestNode, dateTimeNode,
];
