import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

function token(ctx: NodeContext, provider: string): string {
  const value = ctx.credentials[provider]?.accessToken;
  if (typeof value !== "string" || !value.trim()) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value.trim();
}
async function get(ctx: NodeContext, provider: string, url: string): Promise<Record<string, unknown>> {
  const response = await ctx.http.request({ url, method: "GET", headers: { Authorization: "Bearer " + token(ctx, provider) }, timeoutMs: 15000, retries: 0 });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("Google provider request failed", { provider, status: response.status });
    throw new Error(response.status === 429 ? provider.toUpperCase() + "_RATE_LIMITED" : provider.toUpperCase() + "_REQUEST_FAILED");
  }
  if (!response.body || typeof response.body !== "object" || Array.isArray(response.body)) throw new Error(provider.toUpperCase() + "_INVALID_RESPONSE");
  return response.body as Record<string, unknown>;
}
function node<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(args: {
  id: string; name: string; scope: string; description: string; input: I; output: O;
  run(ctx: NodeContext, input: z.infer<I>): Promise<unknown>;
}): NodeDefinition {
  return {
    id: args.id, name: args.name, icon: "app-window", category: "data", version: 1,
    auth: { type: "oauth2", scopes: [args.scope], refresh: "managed" }, triggers: [],
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

export const catalogueGoogleNodes: NodeDefinition[] = [
  node({
    id: "google_drive", name: "Google Drive",
    scope: "https://www.googleapis.com/auth/drive.readonly",
    description: "Lists Google Drive files using the connected read-only Google account and returns bounded file metadata.",
    input: z.object({ query: z.string().max(500).optional(), pageSize: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ files: z.array(z.object({ id: z.string(), name: z.string(), mimeType: z.string().optional(), webViewLink: z.string().url().optional() }).strict()).max(100), nextPageToken: z.string().optional() }).strict(),
    async run(ctx, input) {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("pageSize", String(input.pageSize ?? 20));
      url.searchParams.set("fields", "files(id,name,mimeType,webViewLink),nextPageToken");
      if (input.query) url.searchParams.set("q", input.query);
      const body = await get(ctx, "google_drive", url.toString());
      const files = Array.isArray(body.files) ? body.files.flatMap((item: any) => typeof item?.id === "string" && typeof item?.name === "string"
        ? [{ id: item.id, name: item.name, ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}), ...(typeof item.webViewLink === "string" ? { webViewLink: item.webViewLink } : {}) }] : []) : [];
      return { files: files.slice(0, input.pageSize ?? 20), ...(typeof body.nextPageToken === "string" ? { nextPageToken: body.nextPageToken } : {}) };
    },
  }),
  node({
    id: "google_calendar", name: "Google Calendar",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    description: "Lists events from a selected Google Calendar within a bounded time window using read-only OAuth access.",
    input: z.object({ calendarId: z.string().trim().min(1).max(300).default("primary"), timeMin: z.string().datetime().optional(), timeMax: z.string().datetime().optional(), maxResults: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ events: z.array(z.object({ id: z.string(), summary: z.string().optional(), start: z.unknown().optional(), htmlLink: z.string().url().optional() }).strict()).max(100) }).strict(),
    async run(ctx, input) {
      const url = new URL("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(input.calendarId ?? "primary") + "/events");
      url.searchParams.set("maxResults", String(input.maxResults ?? 20));
      if (input.timeMin) url.searchParams.set("timeMin", input.timeMin);
      if (input.timeMax) url.searchParams.set("timeMax", input.timeMax);
      const body = await get(ctx, "google_calendar", url.toString());
      const events = Array.isArray(body.items) ? body.items.flatMap((item: any) => typeof item?.id === "string"
        ? [{ id: item.id, ...(typeof item.summary === "string" ? { summary: item.summary } : {}), ...(item.start !== undefined ? { start: item.start } : {}), ...(typeof item.htmlLink === "string" ? { htmlLink: item.htmlLink } : {}) }] : []) : [];
      return { events: events.slice(0, input.maxResults ?? 20) };
    },
  }),
  node({
    id: "google_docs", name: "Google Docs",
    scope: "https://www.googleapis.com/auth/documents.readonly",
    description: "Reads Google Docs document metadata and bounded body structure using the connected read-only Google account.",
    input: z.object({ documentId: z.string().trim().min(10).max(200) }).strict(),
    output: z.object({ documentId: z.string(), title: z.string(), revisionId: z.string().optional(), bodyElementCount: z.number().int().nonnegative() }).strict(),
    async run(ctx, input) {
      const body = await get(ctx, "google_docs", "https://docs.googleapis.com/v1/documents/" + encodeURIComponent(input.documentId));
      if (typeof body.documentId !== "string" || typeof body.title !== "string") throw new Error("GOOGLE_DOCS_INVALID_RESPONSE");
      const content = (body.body as Record<string, unknown> | undefined)?.content;
      return { documentId: body.documentId, title: body.title, ...(typeof body.revisionId === "string" ? { revisionId: body.revisionId } : {}), bodyElementCount: Array.isArray(content) ? content.length : 0 };
    },
  }),
  node({
    id: "google_forms", name: "Google Forms",
    scope: "https://www.googleapis.com/auth/forms.body.readonly",
    description: "Reads Google Form metadata and question count using read-only Forms API access.",
    input: z.object({ formId: z.string().trim().min(10).max(200) }).strict(),
    output: z.object({ formId: z.string(), title: z.string(), questionCount: z.number().int().nonnegative() }).strict(),
    async run(ctx, input) {
      const body = await get(ctx, "google_forms", "https://forms.googleapis.com/v1/forms/" + encodeURIComponent(input.formId));
      const info = body.info as Record<string, unknown> | undefined;
      const items = Array.isArray(body.items) ? body.items : [];
      if (typeof body.formId !== "string" || typeof info?.title !== "string") throw new Error("GOOGLE_FORMS_INVALID_RESPONSE");
      return { formId: body.formId, title: info.title, questionCount: items.length };
    },
  }),
  node({
    id: "youtube", name: "YouTube",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    description: "Searches public YouTube videos using the connected account's read-only YouTube scope and returns bounded video metadata.",
    input: z.object({ query: z.string().trim().min(1).max(300), maxResults: z.number().int().min(1).max(50).default(10) }).strict(),
    output: z.object({ videos: z.array(z.object({ videoId: z.string(), title: z.string(), channelTitle: z.string().optional() }).strict()).max(50) }).strict(),
    async run(ctx, input) {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet"); url.searchParams.set("type", "video");
      url.searchParams.set("q", input.query); url.searchParams.set("maxResults", String(input.maxResults ?? 10));
      const body = await get(ctx, "youtube", url.toString());
      const videos = Array.isArray(body.items) ? body.items.flatMap((item: any) => {
        const id = item?.id as Record<string, unknown> | undefined, snippet = item?.snippet as Record<string, unknown> | undefined;
        return typeof id?.videoId === "string" && typeof snippet?.title === "string"
          ? [{ videoId: id.videoId, title: snippet.title, ...(typeof snippet.channelTitle === "string" ? { channelTitle: snippet.channelTitle } : {}) }] : [];
      }) : [];
      return { videos: videos.slice(0, input.maxResults ?? 10) };
    },
  }),
  node({
    id: "google_contacts", name: "Google Contacts",
    scope: "https://www.googleapis.com/auth/contacts.readonly",
    description: "Lists Google Contacts people using read-only People API access and returns bounded names, emails and phone numbers.",
    input: z.object({ pageSize: z.number().int().min(1).max(100).default(50) }).strict(),
    output: z.object({ people: z.array(z.object({ resourceName: z.string(), displayName: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }).strict()).max(100) }).strict(),
    async run(ctx, input) {
      const url = new URL("https://people.googleapis.com/v1/people/me/connections");
      url.searchParams.set("personFields", "names,emailAddresses,phoneNumbers"); url.searchParams.set("pageSize", String(input.pageSize ?? 50));
      const body = await get(ctx, "google_contacts", url.toString());
      const people = Array.isArray(body.connections) ? body.connections.flatMap((person: any) => {
        if (typeof person?.resourceName !== "string") return [];
        const name = Array.isArray(person.names) ? person.names[0]?.displayName : undefined;
        const email = Array.isArray(person.emailAddresses) ? person.emailAddresses[0]?.value : undefined;
        const phone = Array.isArray(person.phoneNumbers) ? person.phoneNumbers[0]?.value : undefined;
        return [{ resourceName: person.resourceName, ...(typeof name === "string" ? { displayName: name } : {}), ...(typeof email === "string" ? { email } : {}), ...(typeof phone === "string" ? { phone } : {}) }];
      }) : [];
      return { people: people.slice(0, input.pageSize ?? 50) };
    },
  }),
];
