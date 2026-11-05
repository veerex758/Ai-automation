/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

type Provider = "claude" | "mistral" | "groq" | "perplexity" | "discord" | "telegram" |
  "whatsapp_business" | "sendgrid" | "mailgun" | "postmark" | "github" | "gitlab" |
  "sentry" | "vercel" | "calendly" | "zendesk" | "freshdesk" | "serpapi" |
  "openweather" | "rss_feed";

function secret(ctx: NodeContext, provider: Provider, field: string): string {
  const value = ctx.credentials[provider]?.[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value.trim();
}

async function call(ctx: NodeContext, provider: Provider, args: {
  url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown;
}): Promise<Record<string, unknown>> {
  const response = await ctx.http.request({
    url: args.url, method: args.method ?? "GET", headers: args.headers,
    ...(args.body === undefined ? {} : { body: args.body }), timeoutMs: 15000, retries: 0,
  });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("Provider operation failed", { provider, status: response.status });
    throw new Error(response.status === 429 ? provider.toUpperCase() + "_RATE_LIMITED" : provider.toUpperCase() + "_REQUEST_FAILED");
  }
  if (!response.body || typeof response.body !== "object" || Array.isArray(response.body)) {
    throw new Error(provider.toUpperCase() + "_INVALID_RESPONSE");
  }
  return response.body as Record<string, unknown>;
}

function actionNode(args: {
  id: Provider; name: string; icon: string; category: NodeDefinition["category"];
  description: string; input: z.ZodTypeAny; output: z.ZodTypeAny; auth?: NodeDefinition["auth"];
  run(ctx: NodeContext, input: any): Promise<unknown>;
}): NodeDefinition {
  return {
    id: args.id, name: args.name, icon: args.icon, category: args.category, version: 1,
    auth: args.auth ?? (args.id === "rss_feed"
      ? { type: "none" }
      : { type: "apiKey", credentialKey: ({
          discord: "botToken", telegram: "botToken", whatsapp_business: "accessToken",
          postmark: "serverToken", github: "token", gitlab: "token", sentry: "authToken",
          vercel: "token", calendly: "accessToken", zendesk: "apiToken",
        } as Partial<Record<Provider, string>>)[args.id] ?? "apiKey" }), triggers: [],
    actions: [{
      id: "execute", name: args.name + " action", description: args.description,
      inputSchema: args.input, outputSchema: args.output,
      async run(ctx, raw) {
        const input = args.input.parse(raw);
        return args.output.parse(await args.run(ctx, input));
      },
    }],
  };
}

const promptInput = z.object({
  prompt: z.string().trim().min(1).max(12000),
  model: z.string().trim().min(1).max(120).optional(),
  maxTokens: z.number().int().min(1).max(4096).default(1024),
}).strict();
const textOutput = z.object({ text: z.string().max(50000), model: z.string().optional() }).strict();

function chatProvider(id: "claude" | "mistral" | "groq" | "perplexity", name: string, endpoint: string, defaultModel: string, headers: (key: string) => Record<string, string>): NodeDefinition {
  return actionNode({
    id, name, icon: "message-square", category: "ai",
    description: "Sends a bounded prompt to " + name + " using this workspace's encrypted API credential and returns generated text.",
    input: promptInput, output: textOutput,
    async run(ctx, input) {
      const key = secret(ctx, id, "apiKey");
      const model = input.model ?? defaultModel;
      const body = await call(ctx, id, {
        url: endpoint, method: "POST", headers: { ...headers(key), "Content-Type": "application/json" },
        body: id === "claude"
          ? { model, max_tokens: input.maxTokens, messages: [{ role: "user", content: input.prompt }] }
          : { model, max_tokens: input.maxTokens, messages: [{ role: "user", content: input.prompt }] },
      });
      const content = id === "claude"
        ? (Array.isArray(body.content) ? body.content.find((part: any) => part && part.type === "text")?.text : undefined)
        : (body.choices as any[] | undefined)?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error(id.toUpperCase() + "_INVALID_RESPONSE");
      return { text: content.slice(0, 50000), model: typeof body.model === "string" ? body.model : model };
    },
  });
}

export const providerPack: NodeDefinition[] = [
  chatProvider("claude", "Claude", "https://api.anthropic.com/v1/messages", "claude-3-5-haiku-latest",
    (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" })),
  chatProvider("mistral", "Mistral", "https://api.mistral.ai/v1/chat/completions", "mistral-small-latest",
    (key) => ({ Authorization: "Bearer " + key })),
  chatProvider("groq", "Groq", "https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile",
    (key) => ({ Authorization: "Bearer " + key })),
  chatProvider("perplexity", "Perplexity", "https://api.perplexity.ai/chat/completions", "sonar",
    (key) => ({ Authorization: "Bearer " + key })),

  actionNode({
    id: "discord", name: "Discord", icon: "messages-square", category: "communication",
    description: "Posts a message to a Discord channel using a bot token. Does not accept arbitrary webhook URLs.",
    input: z.object({ channelId: z.string().regex(/^\d{5,25}$/), content: z.string().trim().min(1).max(1900) }).strict(),
    output: z.object({ messageId: z.string(), channelId: z.string() }).strict(),
    async run(ctx, i) {
      const token = secret(ctx, "discord", "botToken");
      const body = await call(ctx, "discord", { url: "https://discord.com/api/v10/channels/" + encodeURIComponent(i.channelId) + "/messages",
        method: "POST", headers: { Authorization: "Bot " + token, "Content-Type": "application/json" }, body: { content: i.content } });
      if (typeof body.id !== "string") throw new Error("DISCORD_INVALID_RESPONSE");
      return { messageId: body.id, channelId: i.channelId };
    },
  }),
  actionNode({
    id: "telegram", name: "Telegram", icon: "send", category: "communication",
    description: "Sends a text message to a Telegram chat using the workspace bot token.",
    input: z.object({ chatId: z.string().min(1).max(100), text: z.string().trim().min(1).max(4096) }).strict(),
    output: z.object({ messageId: z.number().int(), chatId: z.union([z.string(), z.number()]) }).strict(),
    async run(ctx, i) {
      const token = secret(ctx, "telegram", "botToken");
      const body = await call(ctx, "telegram", { url: "https://api.telegram.org/bot" + token + "/sendMessage",
        method: "POST", headers: { "Content-Type": "application/json" }, body: { chat_id: i.chatId, text: i.text } });
      const result = body.result as Record<string, unknown> | undefined;
      if (body.ok !== true || typeof result?.message_id !== "number") throw new Error("TELEGRAM_INVALID_RESPONSE");
      return { messageId: result.message_id, chatId: (result.chat as Record<string, unknown>)?.id as string | number };
    },
  }),
  actionNode({
    id: "whatsapp_business", name: "WhatsApp Business", icon: "message-circle", category: "communication",
    description: "Sends a WhatsApp Cloud API text message from the connected business phone number.",
    input: z.object({ to: z.string().regex(/^\+[1-9]\d{7,14}$/), text: z.string().trim().min(1).max(4096) }).strict(),
    output: z.object({ messageId: z.string() }).strict(),
    async run(ctx, i) {
      const token = secret(ctx, "whatsapp_business", "accessToken");
      const phone = secret(ctx, "whatsapp_business", "phoneNumberId");
      const body = await call(ctx, "whatsapp_business", { url: "https://graph.facebook.com/v22.0/" + encodeURIComponent(phone) + "/messages",
        method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: { messaging_product: "whatsapp", to: i.to.replace(/^\+/, ""), type: "text", text: { body: i.text } } });
      const message = (body.messages as any[] | undefined)?.[0];
      if (typeof message?.id !== "string") throw new Error("WHATSAPP_INVALID_RESPONSE");
      return { messageId: message.id };
    },
  }),
  actionNode({
    id: "sendgrid", name: "SendGrid", icon: "mail", category: "communication",
    description: "Sends an email through SendGrid using the saved API key and verified sender address.",
    input: z.object({ to: z.string().email(), subject: z.string().trim().min(1).max(200), text: z.string().min(1).max(20000) }).strict(),
    output: z.object({ accepted: z.boolean(), status: z.number().int() }).strict(),
    async run(ctx, i) {
      const key = secret(ctx, "sendgrid", "apiKey"), from = secret(ctx, "sendgrid", "fromEmail");
      const response = await ctx.http.request({ url: "https://api.sendgrid.com/v3/mail/send", method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: { personalizations: [{ to: [{ email: i.to }] }], from: { email: from }, subject: i.subject, content: [{ type: "text/plain", value: i.text }] }, timeoutMs: 15000, retries: 0 });
      if (response.status < 200 || response.status >= 300) throw new Error(response.status === 429 ? "SENDGRID_RATE_LIMITED" : "SENDGRID_REQUEST_FAILED");
      return { accepted: true, status: response.status };
    },
  }),
  actionNode({
    id: "mailgun", name: "Mailgun", icon: "mail", category: "communication",
    description: "Sends a plain-text email through the configured Mailgun domain.",
    input: z.object({ to: z.string().email(), subject: z.string().trim().min(1).max(200), text: z.string().min(1).max(20000) }).strict(),
    output: z.object({ messageId: z.string().optional(), accepted: z.boolean() }).strict(),
    async run(ctx, i) {
      const key = secret(ctx, "mailgun", "apiKey"), domain = secret(ctx, "mailgun", "domain"), from = secret(ctx, "mailgun", "fromEmail");
      const encoded = Buffer.from("api:" + key).toString("base64");
      const form = new URLSearchParams({ from, to: i.to, subject: i.subject, text: i.text }).toString();
      const body = await call(ctx, "mailgun", { url: "https://api.mailgun.net/v3/" + encodeURIComponent(domain) + "/messages",
        method: "POST", headers: { Authorization: "Basic " + encoded, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
      return { accepted: true, ...(typeof body.id === "string" ? { messageId: body.id } : {}) };
    },
  }),
  actionNode({
    id: "postmark", name: "Postmark", icon: "mail", category: "communication",
    description: "Sends a plain-text email through Postmark using the saved server token.",
    input: z.object({ to: z.string().email(), subject: z.string().trim().min(1).max(200), text: z.string().min(1).max(20000) }).strict(),
    output: z.object({ messageId: z.string(), submittedAt: z.string().optional() }).strict(),
    async run(ctx, i) {
      const token = secret(ctx, "postmark", "serverToken"), from = secret(ctx, "postmark", "fromEmail");
      const body = await call(ctx, "postmark", { url: "https://api.postmarkapp.com/email", method: "POST",
        headers: { "X-Postmark-Server-Token": token, "Content-Type": "application/json" },
        body: { From: from, To: i.to, Subject: i.subject, TextBody: i.text } });
      if (typeof body.MessageID !== "string") throw new Error("POSTMARK_INVALID_RESPONSE");
      return { messageId: body.MessageID, ...(typeof body.SubmittedAt === "string" ? { submittedAt: body.SubmittedAt } : {}) };
    },
  }),
  actionNode({
    id: "github", name: "GitHub", icon: "github", category: "developer",
    description: "Creates an issue in a repository accessible to the connected GitHub token.",
    input: z.object({ owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/), repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), title: z.string().trim().min(1).max(250), body: z.string().max(50000).optional() }).strict(),
    output: z.object({ issueNumber: z.number().int(), url: z.string().url() }).strict(),
    async run(ctx, i) {
      const token = secret(ctx, "github", "token");
      const body = await call(ctx, "github", { url: "https://api.github.com/repos/" + encodeURIComponent(i.owner) + "/" + encodeURIComponent(i.repo) + "/issues",
        method: "POST", headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
        body: { title: i.title, ...(i.body ? { body: i.body } : {}) } });
      if (typeof body.number !== "number" || typeof body.html_url !== "string") throw new Error("GITHUB_INVALID_RESPONSE");
      return { issueNumber: body.number, url: body.html_url };
    },
  }),
  actionNode({
    id: "gitlab", name: "GitLab", icon: "gitlab", category: "developer",
    description: "Creates an issue in a GitLab project the connected token can access.",
    input: z.object({ projectId: z.union([z.string().min(1).max(200), z.number().int().positive()]), title: z.string().trim().min(1).max(250), description: z.string().max(50000).optional() }).strict(),
    output: z.object({ issueId: z.number().int(), url: z.string().url() }).strict(),
    async run(ctx, i) {
      const token = secret(ctx, "gitlab", "token");
      const body = await call(ctx, "gitlab", { url: "https://gitlab.com/api/v4/projects/" + encodeURIComponent(String(i.projectId)) + "/issues",
        method: "POST", headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
        body: { title: i.title, ...(i.description ? { description: i.description } : {}) } });
      if (typeof body.id !== "number" || typeof body.web_url !== "string") throw new Error("GITLAB_INVALID_RESPONSE");
      return { issueId: body.id, url: body.web_url };
    },
  }),
  actionNode({
    id: "sentry", name: "Sentry", icon: "bug", category: "developer",
    description: "Lists projects in the configured Sentry organization.",
    input: z.object({ organization: z.string().regex(/^[a-z0-9-]{1,100}$/i) }).strict(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() }).strict()).max(500) }).strict(),
    async run(ctx, i) {
      const token = secret(ctx, "sentry", "authToken");
      const response = await ctx.http.request({
        url: "https://sentry.io/api/0/organizations/" + encodeURIComponent(i.organization) + "/projects/",
        method: "GET", headers: { Authorization: "Bearer " + token }, timeoutMs: 15000, retries: 0,
      });
      if (response.status < 200 || response.status >= 300) {
        ctx.logger.error("Sentry request failed", { status: response.status });
        throw new Error(response.status === 429 ? "SENTRY_RATE_LIMITED" : "SENTRY_REQUEST_FAILED");
      }
      const raw = response.body;
      const projects = Array.isArray(raw) ? raw.flatMap((p: any) => typeof p?.id === "string" && typeof p?.name === "string" && typeof p?.slug === "string" ? [{ id: p.id, name: p.name, slug: p.slug }] : []) : [];
      if (!Array.isArray(raw)) throw new Error("SENTRY_INVALID_RESPONSE");
      return { projects };
    },
  }),
  actionNode({
    id: "vercel", name: "Vercel", icon: "triangle", category: "developer",
    description: "Lists recent deployments visible to the connected Vercel token.",
    input: z.object({ projectId: z.string().min(1).max(100).optional(), limit: z.number().int().min(1).max(50).default(10) }).strict(),
    output: z.object({ deployments: z.array(z.object({ uid: z.string(), state: z.string().optional(), url: z.string().optional() }).strict()).max(50) }).strict(),
    async run(ctx, i) {
      const token = secret(ctx, "vercel", "token");
      const url = new URL("https://api.vercel.com/v6/deployments");
      url.searchParams.set("limit", String(i.limit ?? 10));
      if (i.projectId) url.searchParams.set("projectId", i.projectId);
      const body = await call(ctx, "vercel", { url: url.toString(), headers: { Authorization: "Bearer " + token } });
      const deployments = Array.isArray(body.deployments) ? body.deployments.flatMap((d: any) => typeof d?.uid === "string" ? [{ uid: d.uid, ...(typeof d.state === "string" ? { state: d.state } : {}), ...(typeof d.url === "string" ? { url: d.url } : {}) }] : []) : [];
      return { deployments };
    },
  }),
  actionNode({
    id: "calendly", name: "Calendly", icon: "calendar", category: "data",
    description: "Lists the current user's Calendly event types.",
    input: z.object({ count: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ eventTypes: z.array(z.object({ uri: z.string().url(), name: z.string(), active: z.boolean() }).strict()).max(100) }).strict(),
    async run(ctx, i) {
      const token = secret(ctx, "calendly", "accessToken");
      const body = await call(ctx, "calendly", { url: "https://api.calendly.com/users/me", headers: { Authorization: "Bearer " + token } });
      const user = body.resource as Record<string, unknown> | undefined;
      if (typeof user?.uri !== "string") throw new Error("CALENDLY_INVALID_RESPONSE");
      const events = await call(ctx, "calendly", { url: "https://api.calendly.com/event_types?user=" + encodeURIComponent(user.uri) + "&count=" + (i.count ?? 20), headers: { Authorization: "Bearer " + token } });
      const eventTypes = Array.isArray(events.collection) ? events.collection.flatMap((e: any) => typeof e?.uri === "string" && typeof e?.name === "string" ? [{ uri: e.uri, name: e.name, active: e.active === true }] : []) : [];
      return { eventTypes };
    },
  }),
  actionNode({
    id: "zendesk", name: "Zendesk", icon: "life-buoy", category: "communication",
    description: "Creates a support ticket in the configured Zendesk account.",
    input: z.object({ subject: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(20000), requesterEmail: z.string().email() }).strict(),
    output: z.object({ ticketId: z.number().int(), url: z.string().url().optional() }).strict(),
    async run(ctx, i) {
      const domain = secret(ctx, "zendesk", "subdomain"), email = secret(ctx, "zendesk", "email"), token = secret(ctx, "zendesk", "apiToken");
      if (!/^[a-z0-9-]+$/i.test(domain)) throw new Error("ZENDESK_CONNECTION_INVALID");
      const auth = Buffer.from(email + "/token:" + token).toString("base64");
      const body = await call(ctx, "zendesk", { url: "https://" + domain + ".zendesk.com/api/v2/tickets.json", method: "POST",
        headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" },
        body: { ticket: { subject: i.subject, comment: { body: i.description }, requester: { email: i.requesterEmail } } } });
      const ticket = body.ticket as Record<string, unknown> | undefined;
      if (typeof ticket?.id !== "number") throw new Error("ZENDESK_INVALID_RESPONSE");
      return { ticketId: ticket.id, ...(typeof ticket.url === "string" ? { url: ticket.url } : {}) };
    },
  }),
  actionNode({
    id: "freshdesk", name: "Freshdesk", icon: "life-buoy", category: "communication",
    description: "Creates a support ticket in the configured Freshdesk account.",
    input: z.object({ subject: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(20000), email: z.string().email() }).strict(),
    output: z.object({ ticketId: z.number().int() }).strict(),
    async run(ctx, i) {
      const domain = secret(ctx, "freshdesk", "domain"), key = secret(ctx, "freshdesk", "apiKey");
      if (!/^[a-z0-9-]+$/i.test(domain)) throw new Error("FRESHDESK_CONNECTION_INVALID");
      const auth = Buffer.from(key + ":X").toString("base64");
      const body = await call(ctx, "freshdesk", { url: "https://" + domain + ".freshdesk.com/api/v2/tickets", method: "POST",
        headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" },
        body: { email: i.email, subject: i.subject, description: i.description, priority: 1, status: 2 } });
      if (typeof body.id !== "number") throw new Error("FRESHDESK_INVALID_RESPONSE");
      return { ticketId: body.id };
    },
  }),
  actionNode({
    id: "serpapi", name: "SerpAPI", icon: "search", category: "data",
    description: "Runs a Google search through SerpAPI and returns bounded organic results.",
    input: z.object({ query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(20).default(10) }).strict(),
    output: z.object({ results: z.array(z.object({ title: z.string(), link: z.string().url(), snippet: z.string() }).strict()).max(20) }).strict(),
    async run(ctx, i) {
      const key = secret(ctx, "serpapi", "apiKey");
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google"); url.searchParams.set("q", i.query); url.searchParams.set("api_key", key);
      const body = await call(ctx, "serpapi", { url: url.toString() });
      const results = Array.isArray(body.organic_results) ? body.organic_results.flatMap((r: any) => typeof r?.title === "string" && typeof r?.link === "string" && typeof r?.snippet === "string" ? [{ title: r.title, link: r.link, snippet: r.snippet }] : []).slice(0, i.limit ?? 10) : [];
      return { results };
    },
  }),
  actionNode({
    id: "openweather", name: "OpenWeather", icon: "cloud-sun", category: "data",
    description: "Reads current weather conditions for a city using the OpenWeather API.",
    input: z.object({ city: z.string().trim().min(1).max(120), units: z.enum(["standard", "metric", "imperial"]).default("metric") }).strict(),
    output: z.object({ city: z.string(), temperature: z.number(), description: z.string(), humidity: z.number().int() }).strict(),
    async run(ctx, i) {
      const key = secret(ctx, "openweather", "apiKey");
      const url = new URL("https://api.openweathermap.org/data/2.5/weather");
      url.searchParams.set("q", i.city); url.searchParams.set("units", i.units ?? "metric"); url.searchParams.set("appid", key);
      const body = await call(ctx, "openweather", { url: url.toString() });
      const main = body.main as Record<string, unknown> | undefined, weather = (body.weather as any[] | undefined)?.[0];
      if (typeof body.name !== "string" || typeof main?.temp !== "number" || typeof main.humidity !== "number" || typeof weather?.description !== "string") throw new Error("OPENWEATHER_INVALID_RESPONSE");
      return { city: body.name, temperature: main.temp, description: weather.description, humidity: main.humidity };
    },
  }),
  actionNode({
    id: "rss_feed", name: "RSS Feed", icon: "rss", category: "data", auth: { type: "none" },
    description: "Fetches a feed from a validated public HTTP(S) RSS URL and returns its raw XML as bounded text.",
    input: z.object({ feedUrl: z.string().url(), maxBytes: z.number().int().min(1024).max(100000).default(30000) }).strict(),
    output: z.object({ feedUrl: z.string().url(), xml: z.string().max(100000) }).strict(),
    async run(ctx, i) {
      const url = new URL(i.feedUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new Error("RSS_URL_INVALID");
      const response = await ctx.http.request({ url: url.toString(), method: "GET", timeoutMs: 10000, retries: 0 });
      if (response.status < 200 || response.status >= 300 || typeof response.body !== "string") throw new Error("RSS_FETCH_FAILED");
      const xml = response.body.slice(0, i.maxBytes ?? 30000);
      if (!/^\s*(<\?xml|<rss|<feed)/i.test(xml)) throw new Error("RSS_INVALID_FEED");
      return { feedUrl: url.toString(), xml };
    },
  }),
];

if (providerPack.length !== 20) throw new Error("PROVIDER_PACK_COUNT_INVALID");
