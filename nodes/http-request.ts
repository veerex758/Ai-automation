import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

function privateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const p = address.split(".").map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127 ||
      (p[0] === 192 && p[1] === 0 && p[2] === 0) || (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
      (p[0] === 198 && p[1] === 51 && p[2] === 100) || (p[0] === 203 && p[1] === 0 && p[2] === 113);
  }
  const v6 = address.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") ||
    v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") ||
    v6.startsWith("2001:db8") || v6.startsWith("::ffff:127.") || v6.startsWith("::ffff:10.") ||
    v6.startsWith("::ffff:192.168.") || v6.startsWith("::ffff:169.254.");
}
async function assertPublicHttps(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("HTTP_REQUEST_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" ||
      url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") ||
      url.hostname.endsWith(".internal") || url.hostname.endsWith(".test")) throw new Error("HTTP_REQUEST_SSRF_BLOCKED");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) { if (privateAddress(host)) throw new Error("HTTP_REQUEST_SSRF_BLOCKED"); return url.toString(); }
  let addresses: Array<{ address: string; family: number }>;
  try { addresses = await lookup(host, { all: true, verbatim: true }); } catch { throw new Error("HTTP_REQUEST_DNS_FAILED"); }
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("HTTP_REQUEST_SSRF_BLOCKED");
  return url.toString();
}

const node: NodeDefinition = { id: "http_request", name: "HTTP Request", icon: "globe", category: "developer", version: 1, auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [] };
node.actions.push({ id: "request", name: "Make HTTP request", description: "HTTPS request with workspace credential auth and private-address/redirect protections. DNS preflight is defense-in-depth; use a pinned outbound gateway for high-risk deployments.", inputSchema: z.object({ url: z.string().url().max(2048), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"), headers: z.record(z.string(), z.string().max(2000)).default({}), body: z.json().optional(), auth: z.enum(["none", "bearer", "api_key"]).default("none"), credentialHeader: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).default("Authorization") }).strict(), outputSchema: z.object({ status: z.number().int(), body: z.json(), headers: z.record(z.string(), z.string()).optional() }).strict(), async run(ctx: NodeContext, input) {
  const url = await assertPublicHttps(input.url);
  const headers: Record<string, string> = { Accept: "application/json", ...input.headers };
  if (input.auth !== "none") {
    const key = ctx.credentials.http_request?.apiKey;
    if (!key) throw new Error("HTTP_REQUEST_CONNECTION_REQUIRED");
    if (input.auth === "bearer") headers[input.credentialHeader] = "Bearer " + key;
    else headers[input.credentialHeader] = key;
  }
  if (Object.keys(headers).some((name) => /^(host|connection|content-length|transfer-encoding)$/i.test(name))) throw new Error("HTTP_REQUEST_HEADER_BLOCKED");
  const response = await ctx.http.request({ url, method: input.method, headers, body: input.body, timeoutMs: 15000, retries: 0 });
  return { status: response.status, body: response.body };
} });
export const httpRequestNode = node;