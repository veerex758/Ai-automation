import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePlatformNodeReviewer } from "@/lib/nodes/platform-review-access";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * Platform trust actions are distinct from workspace administration.
 * The user allowlist is fail-closed. The service-role RPC performs each state
 * transition and audit insert atomically and never accepts scan/provenance claims.
 */
export async function POST(request: NextRequest) {
  const reviewer = await resolvePlatformNodeReviewer();
  if (!reviewer.ok) return privateJson({ error: reviewer.error }, reviewer.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: "Request body must be valid JSON." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return privateJson({ error: "Request body must be an object." }, 400);
  }

  const input = body as Record<string, unknown>;
  const action = input.action;
  const resourceId = action === "verify_publisher" ? input.publisherId : input.versionId;
  if (action !== "verify_publisher" && action !== "approve_version") {
    return privateJson({ error: "Unsupported platform review action." }, 400);
  }
  if (typeof resourceId !== "string" || !UUID.test(resourceId)) {
    return privateJson({ error: action === "verify_publisher"
      ? "A valid publisherId is required."
      : "A valid versionId is required." }, 400);
  }

  let evidenceReference: string | null = null;
  if (action === "verify_publisher") {
    if (typeof input.evidenceReference !== "string"
      || input.evidenceReference.trim().length < 12
      || input.evidenceReference.trim().length > 2048
      || !/^https:\/\//i.test(input.evidenceReference.trim())) {
      return privateJson({ error: "A secure evidence reference is required for publisher verification." }, 400);
    }
    evidenceReference = input.evidenceReference.trim();
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("review_node_registry_resource", {
      p_action: action,
      p_resource_id: resourceId,
      p_actor_user_id: reviewer.user.id,
      p_evidence_reference: evidenceReference,
    });
    if (error) {
      const status = error.code === "42501" ? 403
        : error.code === "P0002" ? 404
        : error.code === "22023" ? 409 : 500;
      if (status === 500) console.error("Atomic platform node review failed:", error.code);
      return privateJson({
        error: status === 409
          ? "The review action is blocked by the current registry state or incomplete approval gates."
          : status === 403
            ? "Platform service authorization is unavailable."
            : status === 404
              ? "The registry item was not found."
              : "Could not complete the platform review action.",
      }, status);
    }
    return privateJson({ result: data });
  } catch (error) {
    console.error("Platform node review endpoint failed:", error);
    return privateJson({ error: "Platform review service is not configured." }, 503);
  }
}
