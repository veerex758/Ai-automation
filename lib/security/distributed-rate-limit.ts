import "server-only";
import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type RateLimitOptions = {
  scope: string;
  windowMs: number;
  ipLimit?: number;
  userId?: string;
  userLimit?: number;
  workspaceId?: string;
  workspaceLimit?: number;
  resourceId?: string;
  resourceLimit?: number;
};

type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number };

function trustedClientIp(request: Request): string {
  // Vercel supplies x-real-ip at the edge. Do not trust caller-controlled
  // x-forwarded-for values as the primary rate-limit identity.
  const candidate = request.headers.get("x-real-ip")?.trim() ?? "";
  return isIP(candidate) ? candidate : "unknown";
}

export async function enforceDistributedRateLimit(
  request: Request | NextRequest,
  options: RateLimitOptions,
): Promise<NextResponse | null> {
  const dimensions: Array<{ scope: string; key: string; limit: number }> = [];
  if (options.ipLimit) dimensions.push({ scope: options.scope + ":ip", key: trustedClientIp(request), limit: options.ipLimit });
  if (options.userId && options.userLimit) dimensions.push({ scope: options.scope + ":user", key: options.userId, limit: options.userLimit });
  if (options.workspaceId && options.workspaceLimit) dimensions.push({ scope: options.scope + ":workspace", key: options.workspaceId, limit: options.workspaceLimit });
  if (options.resourceId && options.resourceLimit) {
    dimensions.push({
      scope: options.scope + ":resource",
      key: (options.workspaceId ? options.workspaceId + ":" : "") + options.resourceId,
      limit: options.resourceLimit,
    });
  }
  if (!dimensions.length) throw new Error("RATE_LIMIT_DIMENSION_REQUIRED");

  try {
    const admin = createAdminClient();
    for (const dimension of dimensions) {
      const { data, error } = await admin.rpc("consume_api_rate_limit", {
        p_scope: dimension.scope,
        p_key: dimension.key,
        p_limit: dimension.limit,
        p_window_ms: options.windowMs,
      });
      if (error) throw new Error("RATE_LIMIT_STORE_UNAVAILABLE");
      const result = (Array.isArray(data) ? data[0] : data) as RateLimitResult | null;
      if (!result || typeof result.allowed !== "boolean" || !Number.isFinite(result.retryAfterMs)) {
        throw new Error("RATE_LIMIT_STORE_INVALID_RESPONSE");
      }
      if (!result.allowed) {
        const seconds = Math.min(86400, Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
        return NextResponse.json(
          { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
          { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": String(seconds) } },
        );
      }
    }
    return null;
  } catch {
    // Never downgrade to a process-local counter in a multi-instance service.
    return NextResponse.json(
      { error: "Request protection is temporarily unavailable.", code: "RATE_LIMIT_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
