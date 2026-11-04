import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const p = address.split(".").map(Number);
    const [a, b, c] = p;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const ip = address.toLowerCase().split("%")[0];
    // Only globally-routable 2000::/3 addresses; reject documentation and transition ranges.
    return ip.startsWith("2") || ip.startsWith("3")
      ? !ip.startsWith("2001:db8:") && !ip.startsWith("2001:10:") && !ip.startsWith("2002:")
      : false;
  }
  return false;
}

async function resolvePublicHost(hostname: string): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("HTTP_REQUEST_PRIVATE_HOST_BLOCKED");
  }
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new Error("HTTP_REQUEST_PRIVATE_HOST_BLOCKED");
    return { address: host, family: isIP(host) };
  }
  const records = await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw new Error("HTTP_REQUEST_PRIVATE_HOST_BLOCKED");
  }
  return { address: records[0].address, family: records[0].family };
}

export async function performSafeHttpRequest(input: {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  let url: URL;
  try { url = new URL(input.url); } catch { throw new Error("HTTP_REQUEST_INVALID_URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("HTTP_REQUEST_INVALID_URL");
  }
  if ((url.protocol === "https:" && url.port && url.port !== "443") ||
      (url.protocol === "http:" && url.port && url.port !== "80")) {
    throw new Error("HTTP_REQUEST_PORT_NOT_ALLOWED");
  }
  const target = await resolvePublicHost(url.hostname);
  const body = input.body === undefined ? undefined : typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  if (body && Buffer.byteLength(body, "utf8") > 65536) throw new Error("HTTP_REQUEST_BODY_TOO_LARGE");
  const headers = { ...input.headers };
  for (const key of Object.keys(headers)) {
    if (/^(host|connection|content-length|transfer-encoding)$/i.test(key)) throw new Error("HTTP_REQUEST_HEADER_NOT_ALLOWED");
  }
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = transport({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined,
      path: url.pathname + url.search, method: input.method, headers,
      servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 131072) req.destroy(new Error("HTTP_REQUEST_RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown = raw;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { /* text response */ }
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === "string") responseHeaders[key] = value.slice(0, 1000);
        }
        resolve({ status: response.statusCode ?? 0, body: parsed, headers: responseHeaders });
      });
    });
    req.setTimeout(input.timeoutMs, () => req.destroy(new Error("HTTP_REQUEST_TIMEOUT")));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
