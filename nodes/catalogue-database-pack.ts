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
  id: ProviderId; name: string; description: string; input: I; output: O; auth: NodeDefinition["auth"]; additionalActions?: NodeDefinition["actions"];
  run(ctx: NodeContext, input: z.infer<I>): Promise<unknown>;
}): NodeDefinition {
  return { id: args.id, name: args.name, icon: "database", category: "data", version: 1, auth: args.auth, triggers: [],
    actions: [{ id: "execute", name: args.name + " action", description: args.description, inputSchema: args.input, outputSchema: args.output,
      async run(ctx, raw) { const input = args.input.parse(raw); return args.output.parse(await args.run(ctx, input)); } }, ...(args.additionalActions ?? [])] };
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function assertSupabaseReadKey(key: string): void {
  if (key.startsWith("sb_secret_")) throw new Error("SUPABASE_RESTRICTED_KEY_REQUIRED");
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
      if (claims.role === "service_role") throw new Error("SUPABASE_RESTRICTED_KEY_REQUIRED");
    } catch (error) {
      if (error instanceof Error && error.message === "SUPABASE_RESTRICTED_KEY_REQUIRED") throw error;
    }
  }
}
function hmac(key: Buffer | string, value: string): Buffer { return createHmac("sha256", key).update(value).digest(); }
function awsEncode(value: string): string { return encodeURIComponent(value).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase()); }
function awsCanonicalQuery(url: URL): string { return Array.from(url.searchParams.entries()).sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0).map(([key, value]) => awsEncode(key) + "=" + awsEncode(value)).join("&"); }
function awsSignedHeaders(args: { method: string; url: URL; accessKeyId: string; secretAccessKey: string; region: string; now?: Date }): Record<string, string> {
  const now = args.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256("");
  const canonicalHeaders = "host:" + args.url.host + "\n" + "x-amz-content-sha256:" + payloadHash + "\n" + "x-amz-date:" + amzDate + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [args.method, args.url.pathname, awsCanonicalQuery(args.url), canonicalHeaders, signedHeaders, payloadHash].join("\n");
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
      if (origin.protocol !== "https:" || !origin.hostname.endsWith(".supabase.co") || origin.username || origin.password || origin.hash || origin.search || (origin.pathname !== "/" && origin.pathname !== "")) throw new Error("SUPABASE_CONNECTION_INVALID");
      const url = new URL(origin.origin + "/rest/v1/" + encodeURIComponent(input.table));
      url.searchParams.set("select", "*"); url.searchParams.set("limit", String(input.limit ?? 20));
      const key = secret(ctx, "supabase", "apiKey"); assertSupabaseReadKey(key);
      const response = await request(ctx, "supabase", { url: url.toString(), headers: { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" } });
      if (!Array.isArray(response.body)) throw new Error("SUPABASE_INVALID_RESPONSE");
      return { rows: response.body.slice(0, input.limit ?? 20), count: Math.min(response.body.length, input.limit ?? 20) };
    },
    additionalActions: [{
      id: "get_row", name: "Get one row", description: "Reads at most one row by an exact equality filter through PostgREST; respects the connected key's RLS permissions.",
      inputSchema: z.object({ table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/), column: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/), value: z.string().min(1).max(500) }).strict(),
      outputSchema: z.object({ row: z.record(z.string(), z.unknown()).nullable() }).strict(),
      async run(ctx, raw) {
        const input = z.object({ table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/), column: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/), value: z.string().min(1).max(500) }).strict().parse(raw);
        const base = secret(ctx, "supabase", "projectUrl"); let origin: URL; try { origin = new URL(base); } catch { throw new Error("SUPABASE_CONNECTION_INVALID"); }
        if (origin.protocol !== "https:" || !origin.hostname.endsWith(".supabase.co")) throw new Error("SUPABASE_CONNECTION_INVALID");
        const url = new URL(origin.origin + "/rest/v1/" + encodeURIComponent(input.table)); url.searchParams.set("select", "*"); url.searchParams.set(input.column, "eq." + input.value); url.searchParams.set("limit", "1");
        const key = secret(ctx, "supabase", "apiKey"); assertSupabaseReadKey(key); const response = await request(ctx, "supabase", { url: url.toString(), headers: { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" } });
        if (!Array.isArray(response.body)) throw new Error("SUPABASE_INVALID_RESPONSE"); const row = response.body[0];
        return { row: row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : null };
      },
    }],
  }),
  node({
    id: "postgresql", name: "PostgreSQL", auth: { type: "connectionString", credentialKey: "connectionString" },
    description: "Executes a bounded SELECT-only query inside a read-only transaction with a five-second statement timeout and a 100-row cap.",
    input: z.object({ query: z.string().trim().min(7).max(5000), parameters: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(50).default([]) }).strict(),
    output: z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(100), rowCount: z.number().int().nonnegative() }).strict(),
    async run(ctx, input) {
      const sql = input.query.trim().replace(/;\s*$/, "");
      if (!/^select\b/i.test(sql) || /;|--|\/\*|\*\/|\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|set|reset|vacuum|analyze|pg_sleep|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|dblink|pg_advisory_[a-z_]+|pg_cancel_backend|pg_terminate_backend|pg_reload_conf|pg_rotate_logfile|set_config|nextval|setval|pg_notify)\b/i.test(sql)) throw new Error("POSTGRESQL_READ_ONLY_QUERY_REQUIRED");
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
    additionalActions: [{
      id: "get_database_info", name: "Get database info", description: "Returns database name and server version using a fixed read-only query; no caller-supplied SQL is accepted.",
      inputSchema: z.object({}).strict(), outputSchema: z.object({ database: z.string(), serverVersion: z.string() }).strict(),
      async run(ctx) {
        const pool = new Pool({ connectionString: secret(ctx, "postgresql", "connectionString"), max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000, ssl: { rejectUnauthorized: true } });
        const client = await pool.connect();
        try { await client.query("BEGIN READ ONLY"); await client.query("SET LOCAL statement_timeout = '5000ms'"); const result = await client.query("SELECT current_database() AS database, current_setting('server_version') AS \"serverVersion\""); await client.query("ROLLBACK");
          const row = result.rows[0] as Record<string, unknown> | undefined; if (typeof row?.database !== "string" || typeof row.serverVersion !== "string") throw new Error("POSTGRESQL_INVALID_RESPONSE"); return { database: row.database, serverVersion: row.serverVersion };
        } catch (error) { try { await client.query("ROLLBACK"); } catch { /* best-effort transaction cleanup */ } throw error; } finally { client.release(); await pool.end(); }
      },
    }],
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
    additionalActions: [{
      id: "get_many", name: "Get multiple keys", description: "Reads up to 50 Redis keys with one MGET request; no write or scripting commands are exposed.",
      inputSchema: z.object({ keys: z.array(z.string().min(1).max(512)).min(1).max(50) }).strict(),
      outputSchema: z.object({ values: z.array(z.object({ key: z.string(), value: z.string().nullable() }).strict()).max(50) }).strict(),
      async run(ctx, raw) {
        const input = z.object({ keys: z.array(z.string().min(1).max(512)).min(1).max(50) }).strict().parse(raw);
        const endpoint = secret(ctx, "redis", "restUrl"); let url: URL; try { url = new URL(endpoint); } catch { throw new Error("REDIS_CONNECTION_INVALID"); }
        if (url.protocol !== "https:" || !url.hostname.endsWith(".upstash.io")) throw new Error("REDIS_CONNECTION_INVALID");
        const response = await request(ctx, "redis", { url: url.origin, method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "redis", "token"), "Content-Type": "application/json" }, body: ["MGET", ...input.keys] });
        const result = (response.body as Record<string, unknown>)?.result; if (!Array.isArray(result) || result.length !== input.keys.length || result.some(v => v !== null && typeof v !== "string")) throw new Error("REDIS_INVALID_RESPONSE");
        return { values: input.keys.map((key, i) => ({ key, value: result[i] as string | null })) };
      },
    }],
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
    additionalActions: [{
      id: "get_document", name: "Get document", description: "Reads one Firestore document by a validated collection/document path using the connected Google token.",
      inputSchema: z.object({ documentPath: z.string().regex(/^[A-Za-z0-9_-]{1,100}(?:\/[A-Za-z0-9_-]{1,100}){1,9}$/) }).strict(),
      outputSchema: z.object({ name: z.string(), fields: z.record(z.string(), z.unknown()).optional() }).strict(),
      async run(ctx, raw) {
        const input = z.object({ documentPath: z.string().regex(/^[A-Za-z0-9_-]{1,100}(?:\/[A-Za-z0-9_-]{1,100}){1,9}$/) }).strict().parse(raw);
        const project = secret(ctx, "firebase", "projectId"); if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error("FIREBASE_CONNECTION_INVALID");
        const path = input.documentPath.split("/").map(encodeURIComponent).join("/"); const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(project) + "/databases/(default)/documents/" + path;
        const response = await request(ctx, "firebase", { url, headers: { Authorization: "Bearer " + secret(ctx, "firebase", "accessToken") } }); const doc = response.body as Record<string, unknown>;
        if (typeof doc?.name !== "string") throw new Error("FIREBASE_INVALID_RESPONSE"); return { name: doc.name, ...(doc.fields && typeof doc.fields === "object" ? { fields: doc.fields as Record<string, unknown> } : {}) };
      },
    }],
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
    additionalActions: [{
      id: "get_file_metadata", name: "Get file metadata", description: "Reads Dropbox metadata for a file or folder by provider path or ID; does not download or mutate content.",
      inputSchema: z.object({ path: z.string().min(1).max(1000) }).strict(),
      outputSchema: z.object({ id: z.string(), name: z.string(), path: z.string().optional(), size: z.number().nonnegative().optional() }).strict(),
      async run(ctx, raw) {
        const input = z.object({ path: z.string().min(1).max(1000) }).strict().parse(raw);
        const response = await request(ctx, "dropbox", { url: "https://api.dropboxapi.com/2/files/get_metadata", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "dropbox", "accessToken"), "Content-Type": "application/json" }, body: { path: input.path, include_media_info: false } });
        const data = response.body as Record<string, unknown>; if (typeof data?.id !== "string" || typeof data.name !== "string") throw new Error("DROPBOX_INVALID_RESPONSE");
        return { id: data.id, name: data.name, ...(typeof data.path_display === "string" ? { path: data.path_display } : {}), ...(typeof data.size === "number" ? { size: data.size } : {}) };
      },
    }],
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
      url.searchParams.set("list-type", "2"); url.searchParams.set("max-keys", "100"); if (input.prefix) url.searchParams.set("prefix", input.prefix);
      const headers = awsSignedHeaders({ method: "GET", url, accessKeyId: secret(ctx, "aws_s3", "accessKeyId"), secretAccessKey: secret(ctx, "aws_s3", "secretAccessKey"), region });
      const response = await request(ctx, "aws_s3", { url: url.toString(), headers });
      if (typeof response.body !== "string") throw new Error("AWS_S3_INVALID_RESPONSE");
      const keys = xmlValues(response.body, "Key").slice(0, 100);
      return { keys, truncated: xmlValues(response.body, "IsTruncated")[0] === "true" };
    },
    additionalActions: [{
      id: "get_object_metadata", name: "Get object metadata", description: "Looks up one S3 object by exact key through a bounded prefix listing; never downloads object contents.",
      inputSchema: z.object({ bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/), key: z.string().min(1).max(1024) }).strict(),
      outputSchema: z.object({ key: z.string(), size: z.number().nonnegative().optional(), lastModified: z.string().optional(), etag: z.string().optional() }).strict(),
      async run(ctx, raw) {
        const input = z.object({ bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/), key: z.string().min(1).max(1024) }).strict().parse(raw);
        const region = secret(ctx, "aws_s3", "region"); if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) throw new Error("AWS_S3_CONNECTION_INVALID");
        const url = new URL("https://" + input.bucket + ".s3." + region + ".amazonaws.com/"); url.searchParams.set("list-type", "2"); url.searchParams.set("prefix", input.key); url.searchParams.set("max-keys", "1");
        const headers = awsSignedHeaders({ method: "GET", url, accessKeyId: secret(ctx, "aws_s3", "accessKeyId"), secretAccessKey: secret(ctx, "aws_s3", "secretAccessKey"), region });
        const response = await request(ctx, "aws_s3", { url: url.toString(), headers }); if (typeof response.body !== "string") throw new Error("AWS_S3_INVALID_RESPONSE");
        const keys = xmlValues(response.body, "Key"); if (keys[0] !== input.key) throw new Error("AWS_S3_OBJECT_NOT_FOUND");
        const size = Number(xmlValues(response.body, "Size")[0]); const modified = xmlValues(response.body, "LastModified")[0]; const etag = xmlValues(response.body, "ETag")[0];
        return { key: input.key, ...(Number.isFinite(size) && size >= 0 ? { size } : {}), ...(modified ? { lastModified: modified } : {}), ...(etag ? { etag } : {}) };
      },
    }],
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
      url.searchParams.set("list-type", "2"); url.searchParams.set("max-keys", "100"); if (input.prefix) url.searchParams.set("prefix", input.prefix);
      const headers = awsSignedHeaders({ method: "GET", url, accessKeyId: secret(ctx, "cloudflare_r2", "accessKeyId"), secretAccessKey: secret(ctx, "cloudflare_r2", "secretAccessKey"), region: "auto" });
      const response = await request(ctx, "cloudflare_r2", { url: url.toString(), headers });
      if (typeof response.body !== "string") throw new Error("CLOUDFLARE_R2_INVALID_RESPONSE");
      const keys = xmlValues(response.body, "Key").slice(0, 100);
      return { keys, truncated: xmlValues(response.body, "IsTruncated")[0] === "true" };
    },
    additionalActions: [{
      id: "get_object_metadata", name: "Get object metadata", description: "Looks up one R2 object by exact key through a bounded S3-compatible prefix listing; never downloads object contents.",
      inputSchema: z.object({ bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/), key: z.string().min(1).max(1024) }).strict(),
      outputSchema: z.object({ key: z.string(), size: z.number().nonnegative().optional(), lastModified: z.string().optional(), etag: z.string().optional() }).strict(),
      async run(ctx, raw) {
        const input = z.object({ bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/), key: z.string().min(1).max(1024) }).strict().parse(raw);
        const account = secret(ctx, "cloudflare_r2", "accountId"); if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("CLOUDFLARE_R2_CONNECTION_INVALID");
        const url = new URL("https://" + account + ".r2.cloudflarestorage.com/" + encodeURIComponent(input.bucket)); url.searchParams.set("list-type", "2"); url.searchParams.set("prefix", input.key); url.searchParams.set("max-keys", "1");
        const headers = awsSignedHeaders({ method: "GET", url, accessKeyId: secret(ctx, "cloudflare_r2", "accessKeyId"), secretAccessKey: secret(ctx, "cloudflare_r2", "secretAccessKey"), region: "auto" });
        const response = await request(ctx, "cloudflare_r2", { url: url.toString(), headers }); if (typeof response.body !== "string") throw new Error("CLOUDFLARE_R2_INVALID_RESPONSE");
        const keys = xmlValues(response.body, "Key"); if (keys[0] !== input.key) throw new Error("CLOUDFLARE_R2_OBJECT_NOT_FOUND");
        const size = Number(xmlValues(response.body, "Size")[0]); const modified = xmlValues(response.body, "LastModified")[0]; const etag = xmlValues(response.body, "ETag")[0];
        return { key: input.key, ...(Number.isFinite(size) && size >= 0 ? { size } : {}), ...(modified ? { lastModified: modified } : {}), ...(etag ? { etag } : {}) };
      },
    }],
  }),
];
