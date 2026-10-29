import { isIP } from "node:net";
import { z } from "zod";
import type { NodeContext, NodeDefinition } from "./types";

const httpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const inputSchema = z.object({
  url: z.string().trim().min(1).max(2048).describe("HTTPS endpoint URL. Variables such as {{ $json.email }} are resolved from the previous step."),
  method: httpMethod.default("GET"),
  credentialId: z.string().trim().min(1).max(128).optional().describe("Optional workspace connection label for future multi-credential selection; host-scoped saved HTTP connections are used today."),
  query: z.record(z.string(), z.string().max(2000)).optional(),
  body: z.string().max(32768).optional().describe("JSON request body as text; variables are resolved before parsing."),
  headers: z.record(z.string(), z.string().max(2000)).optional().describe("Request headers. Authentication and hop-by-hop headers are reserved."),
  auth: z.enum(["none", "bearer", "apiKey"]).default("none"),
  authHeader: z.string().trim().min(1).max(128).optional().describe("Header name for apiKey auth; defaults to x-api-key."),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
  retries: z.number().int().min(0).max(2).default(1),
  continueOnError: z.boolean().default(false).describe("Record a failed HTTP result and allow later workflow steps to continue."),
}).strict();

const outputSchema = z.object({
  status: z.number().int().min(100).max(599),
  ok: z.boolean(),
  data: z.unknown(),
}).strict();

const FORBIDDEN_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata.google", "host.docker.internal"]);
const RESERVED_HEADERS = new Set(["authorization", "proxy-authorization", "host", "cookie", "set-cookie", "connection", "content-length", "transfer-encoding", "upgrade"]);

function validateTarget(rawUrl: string, allowedHostsValue: string | undefined): URL {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("HTTP_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("HTTP_URL_NOT_ALLOWED");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || FORBIDDEN_HOSTS.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".local") || isIP(hostname)) {
    throw new Error("HTTP_HOST_NOT_ALLOWED");
  }
  const allowedHosts = (allowedHostsValue ?? "").split(",").map((host) => host.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (!allowedHosts.length || !allowedHosts.includes(hostname)) throw new Error("HTTP_HOST_NOT_ALLOWLISTED");
  url.hash = "";
  return url;
}

function previousJson(ctx: NodeContext): unknown {
  const outputs = Object.values(ctx.previousOutputs);
  return outputs.length ? outputs[outputs.length - 1] : undefined;
}

function pathValue(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveString(value: string, ctx: NodeContext, jsonSafe = false): string {
  const current = previousJson(ctx);
  return value.replace(/\{\{\s*\$json\.([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)\s*\}\}/g, (_match, path: string) => {
    const resolved = pathValue(current, path);
    if (resolved === undefined || resolved === null) throw new Error("HTTP_VARIABLE_NOT_FOUND");
    if (jsonSafe) {
      const serialized = JSON.stringify(resolved);
      return typeof resolved === "string" ? serialized.slice(1, -1) : serialized;
    }
    if (typeof resolved === "object") return JSON.stringify(resolved);
    return String(resolved);
  });
}

export const httpNode: NodeDefinition = {
  id: "http", name: "HTTP Request", icon: "globe", category: "developer", version: 2,
  auth: { type: "apiKey", credentialKey: "allowedHosts" },
  triggers: [],
  actions: [{
    id: "request", name: "Make HTTP request",
    description: "Makes a bounded HTTPS request using GET, POST, PUT, PATCH or DELETE. Resolves {{ $json.path }} variables in URL, headers, query and JSON body. Hostnames must be explicitly allowlisted in the workspace's server-side HTTP connection; public DNS is pinned, redirects are rejected, private/reserved IPs are blocked, request bodies are limited to 32 KiB, responses to 256 KiB and timeouts to 30 seconds. Authentication uses workspace-scoped saved API keys; secrets are never accepted from workflow input.",
    inputSchema, outputSchema,
    async run(ctx, rawInput) {
      const input = inputSchema.parse(rawInput);
      const resolvedUrl = resolveString(input.url, ctx);
      const url = validateTarget(resolvedUrl, ctx.credentials.http?.allowedHosts);
      if (input.query) {
        for (const [key, value] of Object.entries(input.query)) url.searchParams.set(key, resolveString(value, ctx));
      }

      const headers: Record<string, string> = {};
      for (const [name, rawValue] of Object.entries(input.headers ?? {})) {
        const normalized = name.toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || RESERVED_HEADERS.has(normalized)) {
          throw new Error("HTTP_HEADER_NOT_ALLOWED");
        }
        headers[name] = resolveString(rawValue, ctx);
      }

      let body: unknown;
      if (input.body !== undefined) {
        const resolvedBody = resolveString(input.body, ctx, true);
        try { body = JSON.parse(resolvedBody) as unknown; } catch { throw new Error("HTTP_BODY_INVALID_JSON"); }
        if (input.method === "GET" || input.method === "DELETE") throw new Error("HTTP_METHOD_BODY_NOT_ALLOWED");
        headers["content-type"] = headers["content-type"] ?? headers["Content-Type"] ?? "application/json";
      }

      if (input.auth !== "none") {
        let apiKeys: Record<string, unknown>;
        try { apiKeys = JSON.parse(ctx.credentials.http?.apiKeys ?? "{}") as Record<string, unknown>; }
        catch { throw new Error("HTTP_CONNECTION_INVALID"); }
        const apiKey = apiKeys[url.hostname.toLowerCase()];
        if (typeof apiKey !== "string" || !apiKey) throw new Error("HTTP_CONNECTION_REQUIRED");
        if (input.auth === "bearer") headers.authorization = "Bearer " + apiKey;
        else headers[input.authHeader ?? "x-api-key"] = apiKey;
      }

      const response = await ctx.http.request({
        url: url.toString(), method: input.method, headers,
        body, timeoutMs: input.timeoutMs, retries: input.retries,
      });
      const result = { status: response.status, ok: response.status >= 200 && response.status < 300, data: response.body };
      if (!result.ok) {
        ctx.logger.error("HTTP request returned a non-success status", { status: response.status, hostname: url.hostname });
        if (!input.continueOnError) throw new Error(response.status === 429 ? "HTTP_RATE_LIMITED" : "HTTP_REQUEST_FAILED");
      }
      return outputSchema.parse(result);
    },
  }],
};
