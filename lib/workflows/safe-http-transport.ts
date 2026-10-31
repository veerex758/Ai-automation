import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest, type RequestOptions } from "node:https";

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REQUEST_BODY_BYTES = 32 * 1024;
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function isUnsafeAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && octets[2] === 0) || (b === 0 && octets[2] === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && octets[2] === 100))) ||
      (a === 203 && b === 0 && octets[2] === 113) ||
      (a === 255 && b === 255);
  }
  if (family === 6) {
    const value = address.toLowerCase().split("%")[0];
    if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
        /^fe[89ab]/.test(value) || value.startsWith("ff") || value.startsWith("2001:db8:") ||
        value.startsWith("2002:") || value.startsWith("2001:0:") ||
        value.startsWith("64:ff9b:") || value.startsWith("64:ff9b::")) return true;
    const mappedDotted = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isUnsafeAddress(mappedDotted[1]);
    const mappedHex = value.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isUnsafeAddress([high >> 8, high & 255, low >> 8, low & 255].join("."));
    }
    return false;
  }
  return true;
}

function parseResponseBody(raw: string): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return raw; }
}

async function requestOnce(args: {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxResponseBytes?: number;
}): Promise<{ status: number; body: unknown }> {
  let url: URL;
  try { url = new URL(args.url); } catch { throw new Error("HTTP_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("HTTP_URL_NOT_ALLOWED");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || isIP(hostname) || hostname === "localhost" ||
      hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      hostname === "metadata.google.internal" || hostname === "metadata.google" ||
      hostname === "host.docker.internal") {
    throw new Error("HTTP_HOST_NOT_ALLOWED");
  }

  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isUnsafeAddress(address))) {
    throw new Error("HTTP_DNS_TARGET_NOT_PUBLIC");
  }
  const pinned = addresses[0];
  const pinnedLookup = ((requestedHost: string, options: { all?: boolean }, callback: (...values: unknown[]) => void) => {
    if (requestedHost.toLowerCase().replace(/\.$/, "") !== hostname) {
      callback(Object.assign(new Error("HTTP_DNS_HOST_MISMATCH"), { code: "ENOTFOUND" }));
      return;
    }
    if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
    else callback(null, pinned.address, pinned.family);
  }) as NonNullable<RequestOptions["lookup"]>;

  const serializedBody = args.body === undefined ? undefined : JSON.stringify(args.body);
  if (serializedBody !== undefined && Buffer.byteLength(serializedBody, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new Error("HTTP_BODY_TOO_LARGE");
  }
  const timeoutMs = Math.min(30000, Math.max(1000, args.timeoutMs ?? 10000));
  const maxResponseBytes = Math.min(DEFAULT_MAX_RESPONSE_BYTES, Math.max(1024, args.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES));

  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      protocol: "https:",
      hostname,
      port: 443,
      path: url.pathname + url.search,
      method: args.method,
      headers: { "accept-encoding": "identity", ...(args.headers ?? {}) },
      lookup: pinnedLookup,
      servername: hostname,
      timeout: timeoutMs,
    };
    const req = httpsRequest(options, (res) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      res.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += bytes.length;
        if (totalBytes > maxResponseBytes) {
          req.destroy(new Error("HTTP_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(bytes);
      });
      res.on("error", reject);
      res.on("end", () => resolve({
        status: res.statusCode ?? 502,
        body: parseResponseBody(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    req.on("timeout", () => req.destroy(new Error("HTTP_TIMEOUT")));
    req.on("error", reject);
    if (serializedBody !== undefined) req.write(serializedBody);
    req.end();
  });
}

/** Public HTTPS transport: validates/pins DNS, refuses redirects, bounds payloads and retries transient responses. */
export async function safeHttpsRequest(args: {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxResponseBytes?: number;
  retries?: number;
}): Promise<{ status: number; body: unknown }> {
  const retries = Math.min(2, Math.max(0, Math.floor(args.retries ?? 0)));
  // Never automatically replay a potentially non-idempotent write unless the caller
  // supplies an idempotency key accepted by the destination API.
  const replaySafe = args.method === "GET" || Boolean(args.headers && Object.keys(args.headers).some((key) => key.toLowerCase() === "idempotency-key"));
  const attempts = replaySafe ? retries + 1 : 1;
  for (let attempt = 0; ; attempt++) {
    const result = await requestOnce(args);
    if (attempt >= attempts - 1 || !(result.status === 429 || result.status >= 500)) return result;
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * (2 ** attempt), 3000)));
  }
}
