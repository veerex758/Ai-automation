import { isIP } from "node:net";
import { z } from "zod";
import type { NodeDefinition } from "./types";

const inputSchema = z.object({
  url: z.string().trim().min(1).max(2048).describe("HTTPS endpoint URL. Its hostname must exactly match a server-configured allowed host."),
  method: z.enum(["GET", "POST"]).default("GET").describe("HTTP method; only GET and POST are supported."),
  query: z.record(z.string(), z.string().max(2000)).optional().describe("Optional query parameters appended to the URL."),
  body: z.unknown().optional().describe("Optional JSON request body for POST only; limited to 32 KiB."),
  headers: z.record(z.string(), z.string().max(2000)).optional().describe("Optional non-sensitive Accept or Content-Type headers only. Secrets must use the server-side connection."),
  auth: z.enum(["none", "bearer"]).default("none").describe("Use a server-stored API key as a Bearer token, never a workflow-supplied secret."),
}).strict();

const outputSchema = z.object({ status: z.number().int().min(100).max(599), body: z.unknown() }).strict();
const MAX_BODY_BYTES = 32 * 1024;
const FORBIDDEN_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata.google", "host.docker.internal"]);

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

export const httpNode: NodeDefinition = {
  id: "http", name: "HTTP Request", icon: "globe", category: "developer", version: 1,
  auth: { type: "apiKey", credentialKey: "allowedHosts" },
  triggers: [],
  actions: [{
    id: "request", name: "Make HTTP request",
    description: "Makes a bounded HTTPS GET or POST request to a hostname explicitly allowlisted in the server-side HTTP connection. Supports query parameters, JSON POST bodies up to 32 KiB, safe Accept/Content-Type headers, and an optional server-stored Bearer API key. Blocks IP literals, localhost, custom ports, URL credentials and unapproved hosts. The shared server transport pins validated public DNS answers to the TLS connection, rejects redirects, blocks private/reserved IPv4 and IPv6 destinations, caps responses at 256 KiB, caps request bodies at 32 KiB and enforces a 10-second timeout.",
    inputSchema, outputSchema,
    async run(ctx, rawInput) {
      const input = inputSchema.parse(rawInput);
      const url = validateTarget(input.url, ctx.credentials.http?.allowedHosts);
      if (input.query) for (const [key, value] of Object.entries(input.query)) url.searchParams.set(key, value);
      if (input.method === "GET" && input.body !== undefined) throw new Error("HTTP_GET_BODY_NOT_ALLOWED");
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(input.headers ?? {})) {
        const normalized = name.toLowerCase();
        if (!["accept", "content-type"].includes(normalized)) throw new Error("HTTP_HEADER_NOT_ALLOWED");
        headers[normalized] = value;
      }
      if (input.body !== undefined) {
        const serialized = JSON.stringify(input.body);
        if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_BODY_BYTES) throw new Error("HTTP_BODY_TOO_LARGE");
        headers["content-type"] = headers["content-type"] ?? "application/json";
      }
      if (input.auth === "bearer") {
        const apiKey = ctx.credentials.http?.apiKey;
        if (!apiKey) throw new Error("HTTP_CONNECTION_REQUIRED");
        headers.authorization = "Bearer " + apiKey;
      }
      const response = await ctx.http.request({
        url: url.toString(), method: input.method, headers,
        body: input.method === "POST" ? input.body : undefined,
        timeoutMs: 10000, retries: 0,
      });
      if (response.status < 200 || response.status >= 300) {
        ctx.logger.error("HTTP request failed", { status: response.status, hostname: url.hostname });
        throw new Error(response.status === 429 ? "HTTP_RATE_LIMITED" : "HTTP_REQUEST_FAILED");
      }
      return outputSchema.parse({ status: response.status, body: response.body });
    },
  }],
};
