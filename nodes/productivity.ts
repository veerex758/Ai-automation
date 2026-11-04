import { z } from "zod";
import type { NodeDefinition } from "./types";

const required = (max = 4000) => z.string().trim().min(1).max(max);
function secret(ctx: { credentials: Readonly<Record<string, Readonly<Record<string, string>>>> }, provider: string, field: string) {
  const value = ctx.credentials[provider]?.[field];
  if (!value) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value;
}
function ok(status: number, provider: string) {
  if (status < 200 || status >= 300) throw new Error(provider.toUpperCase() + (status === 429 ? "_RATE_LIMITED" : "_REQUEST_FAILED"));
}
const blocked = (provider: string) => async () => { throw new Error(provider.toUpperCase() + "_ADAPTER_NOT_ENABLED_PENDING_SECURITY_REVIEW"); };

export const productivityNodes: NodeDefinition[] = [
  {
    id: "coda", name: "Coda", icon: "file-text", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "apiToken" }, triggers: [], actions: [{
      id: "list_docs", name: "List docs", description: "Lists documents accessible to the connected Coda API token. Read-only; returns a bounded first page.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(25) }).strict(),
      outputSchema: z.object({ docs: z.array(z.object({ id: z.string(), name: z.string(), browserLink: z.string().optional() })) }).strict(),
      async run(ctx, raw) {
        const i = z.object({ limit: z.number().int().min(1).max(100).default(25) }).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://coda.io/apis/v1/docs?limit=" + i.limit, method: "GET", headers: { Authorization: "Bearer " + secret(ctx, "coda", "apiToken"), Accept: "application/json" }, timeoutMs: 12000, retries: 0 });
        ok(r.status, "coda");
        const b = r.body as { items?: Array<{ id?: string; name?: string; browserLink?: string }> };
        if (!Array.isArray(b.items)) throw new Error("CODA_INVALID_RESPONSE");
        return { docs: b.items.filter(x => x.id && x.name).map(x => ({ id: x.id as string, name: x.name as string, browserLink: x.browserLink })) };
      },
    }],
  },
  {
    id: "confluence", name: "Confluence", icon: "book-open", category: "data", version: 1,
    auth: { type: "connectionString", credentialKey: "cloudUrl" }, triggers: [], actions: [{
      id: "search_pages", name: "Search pages", description: "Confluence tenant URLs are customer-controlled. This action is gated until the outbound HTTP gateway validates DNS/IP ranges, blocks redirects and pins approved tenant hosts.",
      inputSchema: z.object({ query: required(1000) }).strict(), outputSchema: z.object({ pages: z.array(z.record(z.string(), z.unknown())) }).strict(), run: blocked("confluence"),
    }],
  },
  {
    id: "obsidian", name: "Obsidian", icon: "book", category: "data", version: 1,
    auth: { type: "connectionString", credentialKey: "vaultBridge" }, triggers: [], actions: [{
      id: "read_note", name: "Read note", description: "Obsidian vaults are local files. No hosted public API is assumed; this action requires a user-installed local bridge with explicit vault-path sandboxing and is disabled here.",
      inputSchema: z.object({ path: required(500) }).strict(), outputSchema: z.object({ content: z.string() }).strict(), run: blocked("obsidian"),
    }],
  },
  {
    id: "evernote", name: "Evernote", icon: "notebook", category: "data", version: 1,
    auth: { type: "oauth2", scopes: ["notes.read"], refresh: "managed" }, triggers: [], actions: [{
      id: "search_notes", name: "Search notes", description: "Evernote API compatibility and OAuth availability must be verified against the current account/API program before enabling this connector.",
      inputSchema: z.object({ query: required(1000) }).strict(), outputSchema: z.object({ notes: z.array(z.record(z.string(), z.unknown())) }).strict(), run: blocked("evernote"),
    }],
  },
  {
    id: "basecamp", name: "Basecamp", icon: "briefcase-business", category: "data", version: 1,
    auth: { type: "connectionString", credentialKey: "accountUrl" }, triggers: [], actions: [{
      id: "list_projects", name: "List projects", description: "Basecamp account URLs are tenant-controlled. This action remains disabled pending SSRF-safe outbound routing and verified account-specific API behavior.",
      inputSchema: z.object({}).strict(), outputSchema: z.object({ projects: z.array(z.record(z.string(), z.unknown())) }).strict(), run: blocked("basecamp"),
    }],
  },
];
