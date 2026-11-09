import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Narrow HTTP bridge to a separately deployed, sandboxed community-node worker.
 * This module intentionally does not download, unpack, import, or eval packages.
 * The worker must independently enforce its sandbox and capability broker.
 */
export type CommunityNodeInvocation = {
  packageVersionId: string;
  integrity: string;
  entrypoint: string;
  operation: string;
  input: unknown;
  permissions: string[];
  workspaceId: string;
  installationId: string;
  invocationId?: string;
};

export type CommunityNodeWorkerResult = { output: unknown; logs?: Array<{ level: "info" | "error"; message: string }> };

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("COMMUNITY_NODE_WORKER_NOT_CONFIGURED");
  return value;
}

function hmac(secret: string, timestamp: string, nonce: string, body: string): string {
  return createHmac("sha256", secret).update(timestamp + "." + nonce + "." + body).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export async function invokeCommunityNode(args: CommunityNodeInvocation): Promise<CommunityNodeWorkerResult> {
  const endpoint = new URL(requiredEnv("AIVANTA_COMMUNITY_NODE_WORKER_URL"));
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("COMMUNITY_NODE_WORKER_URL_INVALID");
  }
  const secret = requiredEnv("AIVANTA_COMMUNITY_NODE_WORKER_SECRET");
  if (secret.length < 32) throw new Error("COMMUNITY_NODE_WORKER_SECRET_INVALID");

  const payload = {
    schemaVersion: 1,
    invocationId: args.invocationId ?? randomUUID(),
    packageVersionId: args.packageVersionId,
    integrity: args.integrity,
    entrypoint: args.entrypoint,
    operation: args.operation,
    input: args.input,
    permissions: [...new Set(args.permissions)],
    workspaceId: args.workspaceId,
    installationId: args.installationId,
    limits: { cpuMs: 2_000, memoryMb: 64, wallTimeMs: DEFAULT_TIMEOUT_MS, outputBytes: MAX_RESPONSE_BYTES },
  };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error("COMMUNITY_NODE_INPUT_TOO_LARGE");

  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const signature = hmac(secret, timestamp, nonce, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-aivanta-timestamp": timestamp,
        "x-aivanta-nonce": nonce,
        "x-aivanta-signature": signature,
      },
      body,
    });
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_RESPONSE_BYTES) throw new Error("COMMUNITY_NODE_OUTPUT_TOO_LARGE");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("COMMUNITY_NODE_OUTPUT_TOO_LARGE");
    if (!response.ok) throw new Error("COMMUNITY_NODE_WORKER_FAILED");
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("COMMUNITY_NODE_WORKER_INVALID_RESPONSE"); }
    if (!parsed || typeof parsed !== "object" || !("output" in parsed)) throw new Error("COMMUNITY_NODE_WORKER_INVALID_RESPONSE");
    return parsed as CommunityNodeWorkerResult;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("COMMUNITY_NODE_WORKER_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Worker-side helper for verifying the signed request envelope (timestamp freshness is separate). */
export function verifyCommunityWorkerSignature(args: { secret: string; timestamp: string; nonce: string; body: string; signature: string }): boolean {
  const timestampNumber = Number(args.timestamp);
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(Date.now() - timestampNumber) > 30_000) return false;
  return safeEqualHex(hmac(args.secret, args.timestamp, args.nonce, args.body), args.signature);
}
