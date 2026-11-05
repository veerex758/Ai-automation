/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, createHmac } from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";
import type { NodeContext, NodeDefinition } from "./types";

type ProviderId = "supabase" | "postgresql" | "redis" | "firebase" | "dropbox" | "aws_s3" | "cloudflare_r2";
function secret(ctx: NodeContext, provider: ProviderId, field: string): string {
  const value = ctx.credentials[provider]?.[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value.trim();
}
async function request(ctx: NodeContext, provider: ProviderId, args: { url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; body: unknown }> {
  const response = await ctx.http.request({ url: args.url, method: args.method ?? "GET", headers: args.headers, ...(args.body === undefined ? {} : { body: args.body }), timeoutMs: 15000, retries: 0 });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("Database/storage provider request failed", { provider, status: response.status });
    throw new Error(response.status === 429 ? provider.toUpperCase() + "_RATE_LIMITED" : provider.toUpperCase() + "_REQUEST_FAILED");
  }
  return response;
}
function node<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(args: {
  id: ProviderId; name: string; description: string; input: I; output: O; auth: NodeDefinition["auth"];
  run(ctx: NodeContext, input: z.infer<I>): Promise<unknown>;
}): NodeDefinition {
  return { id: args.id, name: args.name, icon: "database", category: "data", version: 1, auth: args.auth, triggers: [],
    actions: [{ id: "execute", name: args.name + " action", description: args.description, inputSchema: args.input, outputSchema: args.output,
      async run(ctx, raw) { const input = args.input.parse(raw); return args.output.parse(await args.run(ctx, input)); } }] };
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function hmac(key: Buffer | string, value: string): Buffer { return createHmac("sha256", key).update(value).digest(); }
function awsSignedHeaders(args: { method: string; url: URL; accessKeyId: string; secretAccessKey: string; region: string; now?: Date }): Record<string, string> {
  const now = args.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256("");
  const canonicalHeaders = "host:" + args.url.host + "\n" + "x-amz-content-sha256:" + payloadHash + "\n" + "x-amz-date:" + amzDate + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [args.method, args.url.pathname, args.url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = date + "/" + args.region + "/s3/aws4_request";
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac("AWS4" + args.secretAccessKey, date);
  const kRegion = hmac(kDate, args.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return { "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, Authorization: "AWS4-HMAC-SHA256 Credential=" + args.accessKeyId + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature };
}
function xmlValues(xml: string, tag: string): string[] {
  return Array.from(xml.matchAll(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "g")), (match) => match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
}

export const catalogueDatabaseNodes: NodeDefinition[] = [
  node({
    id: "supabase", name: "Supabase", auth: { type: "apiKey", credentialKey: "apiKey" },
    description: "Reads a bounded page from a Supabase table through its PostgREST API using a workspace API key. The operation is read-only.",
    input: z.object({ table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/), limit: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(100), count: z.number().int().nonnegative() }).strict(),
    async run(ctx, input) {
      const base = secret(ctx, "supabase", "projectUrl");
      let origin: URL; try { origin = new URL(base); } catch { throw new Error("SUPABASE_CONNECTION_INVALID"); }
      if (origin.protocol !== "https:" || !origin.hostname.endsWith(".supabase.co")) throw new Error("SUPABASE_CONNECTION_INVALID");
      const url = new URL(origin.origin + "/rest/v1/" + encodeURIComponent(input.table));
      url.searchParams.set("select", "*"); url.searchParams.set("limit", String(input.limit ?? 20));
      const key = secret(ctx, "supabase", "apiKey");
      const response = await request(ctx, "supabase", { url: url.toString(), headers: { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" } });
      if (!Array.isArray(response.body)) throw new Error("SUPABASE_INVALID_RESPONSE");
      return { rows: response.body.slice(0, input.limit ?? 20), count: Math.min(response.body.length, input.limit ?? 20) };
    },
  }),
  node({
    id: "postgresql", name: "PostgreSQL", auth: { type: "connectionString", credentialKey: "connectionString" },
    description: "Executes a bounded SELECT-only query inside a read-only transaction with a five-second statement timeout and a 100-row cap.",
    input: z.object({ query: z.string().trim().min(7).max(5000), parameters: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(50).default([]) }).strict(),
    output: z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(100), rowCount: z.number().int().nonnegative() }).strict(),
    async run(ctx, input) {
      const sql = input.query.trim().replace(/;\s*$/, "");
      if (!/^select\b/i.test(sql) || /;|--|\/\*|\*\/|\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|set|reset|vacuum|analyze|pg_sleep|lo_import|lo_export)\b/i.test(sql)) throw new Error("POSTGRESQL_READ_ONLY_QUERY_REQUIRED");
      const pool = new Pool({ connectionString: secret(ctx, "postgresql", "connectionString"), max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000, statement_timeout: 5000, ssl: { rejectUnauthorized: true } });
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        const result = await client.query(sql, input.parameters ?? []);
        const rows = result.rows.slice(0, 100);
        await client.query("ROLLBACK");
        return { rows, rowCount: rows.length };
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* best-effort transaction cleanup */ }
        throw error;
      } finally {
        client.release();
        await pool.end();
      }
    },
  }),
  node({
    id: "redis", name: "Redis", auth: { type: "apiKey", credentialKey: "token" },
    description: "Reads one key through an Upstash Redis REST endpoint. Only GET is exposed; mutation commands are not supported.",
    input: z.object({ key: z.string().min(1).max(512) }).strict(),
    output: z.object({ key: z.string(), value: z.string().nullable() }).strict(),
    async run(ctx, input) {
      const endpoint = secret(ctx, "redis", "restUrl");
      let url: URL; try { url = new URL(endpoint); } catch { throw new Error("REDIS_CONNECTION_INVALID"); }
      if (url.protocol !== "https:" || !url.hostname.endsWith(".upstash.io")) throw new Error("REDIS_CONNECTION_INVALID");
      const response = await request(ctx, "redis", { url: url.origin, method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "redis", "token"), "Content-Type": "application/json" }, body: ["GET", input.key] });
      const body = response.body as Record<string, unknown>;
      if (!body || typeof body !== "object" || !(typeof body.result === "string" || body.result === null)) throw new Error("REDIS_INVALID_RESPONSE");
      return { key: input.key, value: body.result as string | null };
    },
  }),
  node({
    id: "firebase", name: "Firebase", auth: { type: "oauth2", scopes: ["https://www.googleapis.com/auth/datastore"], refresh: "manual" },
    description: "Lists a bounded page of Firestore documents in one collection using a workspace Google access token.",
    input: z.object({ collection: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), pageSize: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ documents: z.array(z.object({ name: z.string(), fields: z.record(z.string(), z.unknown()).optional() }).strict()).max(100) }).strict(),
    async run(ctx, input) {
      const project = secret(ctx, "firebase", "projectId");
      if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error("FIREBASE_CONNECTION_INVALID");
      const url = new URL("https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(project) + "/databases/(default)/documents/" + encodeURIComponent(input.collection));
      url.searchParams.set("pageSize", String(input.pageSize ?? 20));
      const response = await request(ctx, "firebase", { url: url.toString(), headers: { Authorization: "Bearer " + secret(ctx, "firebase", "accessToken") } });
      const data = response.body as Record<string, unknown>;
      const docs = Array.isArray(data?.documents) ? data.documents.flatMap((doc: any) => typeof doc?.name === "string" ? [{ name: doc.name, ...(doc.fields && typeof doc.fields === "object" ? { fields: doc.fields } : {}) }] : []) : [];
      return { documents: docs.slice(0, input.pageSize ?? 20) };
    },
  }),
  node({
    id: "dropbox", name: "Dropbox", auth: { type: "oauth2", scopes: ["files.metadata.read"], refresh: "manual" },
    description: "Lists files in a selected Dropbox folder using the workspace access token; it does not modify or delete files.",
    input: z.object({ path: z.string().max(1000).default(""), limit: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ entries: z.array(z.object({ id: z.string(), name: z.string(), path: z.string().optional() }).strict()).max(100) }).strict(),
    async run(ctx, input) {
      const response = await request(ctx, "dropbox", { url: "https://api.dropboxapi.com/2/files/list_folder", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "dropbox", "accessToken"), "Content-Type": "application/json" }, body: { path: input.path ?? "", recursive: false, limit: input.limit ?? 20 } });
      const data = response.body as Record<string, unknown>;
      const entries = Array.isArray(data?.entries) ? data.entries.flatMap((entry: any) => typeof entry?.id === "string" && typeof entry?.name === "string" ? [{ id: entry.id, name: entry.name, ...(typeof entry.path_display === "string" ? { path: entry.path_display } : {}) }] : []) : [];
      return { entries: entries.slice(0, input.limit ?? 20) };
    },
  }),
  node({
    id: "aws_s3", name: "AWS S3", auth: { type: "apiKey", credentialKey: "accessKeyId" },
    description: "Lists object keys in an AWS S3 bucket using SigV4 signing. This operation is read-only and returns at most 100 keys.",
    input: z.object({ bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/), prefix: z.string().max(500).default("") }).strict(),
    output: z.object({ keys: z.array(z.string()).max(100), truncated: z.boolean() }).strict(),
    async run(ctx, input) {
      const region = secret(ctx, "aws_s3", "region");
      if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) throw new Error("AWS_S3_CONNECTION_INVALID");
      const url = new URL("https://" + input.bucket + ".s3." + region + ".amazonaws.com/");
      url.searchParams.set("list-type", "2"); if (input.prefix) url.searchParams.set("prefix", input.prefix);
      const headers = awsSignedHeaders({ method: "GET", url, accessKeyId: secret(ctx, "aws_s3", "accessKeyId"), secretAccessKey: secret(ctx, "aws_s3", "secretAccessKey"), region });
      const response = await request(ctx, "aws_s3", { url: url.toString(), headers });
      if (typeof response.body !== "string") throw new Error("AWS_S3_INVALID_RESPONSE");
      const keys = xmlValues(response.body, "Key").slice(0, 100);
      return { keys, truncated: xmlValues(response.body, "IsTruncated")[0] === "true" };
    },
  }),
  node({
    id: "cloudflare_r2", name: "Cloudflare R2", auth: { type: "apiKey", credentialKey: "accessKeyId" },
    description: "Lists object keys in a Cloudflare R2 bucket through its S3-compatible API using SigV4 signing. This operation is read-only.",
    input: z.object({ bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/), prefix: z.string().max(500).default("") }).strict(),
    output: z.object({ keys: z.array(z.string()).max(100), truncated: z.boolean() }).strict(),
    async run(ctx, input) {
      const account = secret(ctx, "cloudflare_r2", "accountId");
      if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("CLOUDFLARE_R2_CONNECTION_INVALID");
      const url = new URL("https://" + account + ".r2.cloudflarestorage.com/" + encodeURIComponent(input.bucket));
      url.searchParams.set("list-type", "2"); if (input.prefix) url.searchParams.set("prefix", input.prefix);
      const headers = awsSignedHeaders({ method: "GET", url, accessKeyId: secret(ctx, "cloudflare_r2", "accessKeyId"), secretAccessKey: secret(ctx, "cloudflare_r2", "secretAccessKey"), region: "auto" });
      const response = await request(ctx, "cloudflare_r2", { url: url.toString(), headers });
      if (typeof response.body !== "string") throw new Error("CLOUDFLARE_R2_INVALID_RESPONSE");
      const keys = xmlValues(response.body, "Key").slice(0, 100);
      return { keys, truncated: xmlValues(response.body, "IsTruncated")[0] === "true" };
    },
  }),
];
