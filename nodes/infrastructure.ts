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
const blocked = (provider: string) => async () => { throw new Error(provider.toUpperCase() + "_ADAPTER_BLOCKED_PENDING_SECURE_CONNECTOR"); };

export const infrastructureNodes: NodeDefinition[] = [
  {
    id: "algolia", name: "Algolia", icon: "search", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "searchApiKey" }, triggers: [], actions: [{
      id: "search_index", name: "Search index", description: "Searches an Algolia index using a search-only API key. This action is read-only; use an index-scoped search key.",
      inputSchema: z.object({ applicationId: required(100), indexName: required(200), query: z.string().max(1000), hitsPerPage: z.number().int().min(1).max(100).default(20) }).strict(),
      outputSchema: z.object({ hits: z.array(z.record(z.string(), z.unknown())), nbHits: z.number().int().nonnegative() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ applicationId: required(100), indexName: required(200), query: z.string().max(1000), hitsPerPage: z.number().int().min(1).max(100).default(20) }).strict().parse(raw);
        if (!/^[A-Z0-9]+$/i.test(i.applicationId)) throw new Error("ALGOLIA_INVALID_APPLICATION_ID");
        const r = await ctx.http.request({ url: "https://" + i.applicationId + "-dsn.algolia.net/1/indexes/" + encodeURIComponent(i.indexName) + "/query", method: "POST", headers: { "X-Algolia-Application-Id": i.applicationId, "X-Algolia-API-Key": secret(ctx, "algolia", "searchApiKey"), "Content-Type": "application/json" }, body: { query: i.query, hitsPerPage: i.hitsPerPage }, timeoutMs: 12000, retries: 0 });
        ok(r.status, "algolia");
        const b = r.body as { hits?: Array<Record<string, unknown>>; nbHits?: number };
        if (!Array.isArray(b.hits) || typeof b.nbHits !== "number") throw new Error("ALGOLIA_INVALID_RESPONSE");
        return { hits: b.hits, nbHits: b.nbHits };
      },
    }],
  },
  {
    id: "cloudflare", name: "Cloudflare", icon: "cloud", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "apiToken" }, triggers: [], actions: [{
      id: "list_zones", name: "List zones", description: "Reads zones accessible to a Cloudflare API token. Requires Zone:Read permission; no DNS or security settings are changed.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ zones: z.array(z.object({ id: z.string(), name: z.string(), status: z.string().optional() })) }).strict(),
      async run(ctx, raw) {
        z.object({}).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://api.cloudflare.com/client/v4/zones?per_page=50", method: "GET", headers: { Authorization: "Bearer " + secret(ctx, "cloudflare", "apiToken"), Accept: "application/json" }, timeoutMs: 12000, retries: 0 });
        ok(r.status, "cloudflare");
        const b = r.body as { success?: boolean; result?: Array<{ id?: string; name?: string; status?: string }> };
        if (!b.success || !Array.isArray(b.result)) throw new Error("CLOUDFLARE_INVALID_RESPONSE");
        return { zones: b.result.filter(x => x.id && x.name).map(x => ({ id: x.id as string, name: x.name as string, status: x.status })) };
      },
    }],
  },
  {
    id: "neon", name: "Neon", icon: "database", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{
      id: "list_projects", name: "List projects", description: "Neon project API adapter is intentionally gated pending account-scoped pagination and response-contract tests.",
      inputSchema: z.object({}).strict(), outputSchema: z.object({ projects: z.array(z.record(z.string(), z.unknown())) }).strict(), run: blocked("neon"),
    }],
  },
  {
    id: "planetscale", name: "PlanetScale", icon: "database", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "serviceToken" }, triggers: [], actions: [{
      id: "list_databases", name: "List databases", description: "PlanetScale API adapter is gated pending organization scoping and account-specific response tests.",
      inputSchema: z.object({ organization: required(100) }).strict(), outputSchema: z.object({ databases: z.array(z.record(z.string(), z.unknown())) }).strict(), run: blocked("planetscale"),
    }],
  },
  {
    id: "elasticsearch", name: "Elasticsearch", icon: "database", category: "data", version: 1,
    auth: { type: "connectionString", credentialKey: "clusterUrl" }, triggers: [], actions: [{
      id: "search", name: "Search", description: "Elasticsearch cluster URLs are tenant-controlled. This action remains disabled until the outbound gateway enforces SSRF-safe DNS/IP validation, redirect blocking and host pinning.",
      inputSchema: z.object({ index: required(255), query: z.record(z.string(), z.unknown()) }).strict(), outputSchema: z.object({ hits: z.array(z.record(z.string(), z.unknown())) }).strict(), run: blocked("elasticsearch"),
    }],
  },
  {
    id: "docker_ssh", name: "Docker / SSH", icon: "terminal", category: "developer", version: 1,
    auth: { type: "connectionString", credentialKey: "connection" }, triggers: [], actions: [{
      id: "execute_command", name: "Execute command", description: "Remote command execution is disabled. A safe implementation requires an isolated job runner, strict command allowlists, workspace-specific key isolation, network egress controls, resource quotas and explicit per-run approval.",
      inputSchema: z.object({ command: required(1000), timeoutSeconds: z.number().int().min(1).max(30).default(10) }).strict(), outputSchema: z.object({ exitCode: z.number().int(), stdout: z.string(), stderr: z.string() }).strict(), run: blocked("docker_ssh"),
    }],
  },
];
