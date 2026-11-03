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
 * Platform trust actions are not workspace-admin actions.
 * The server-side allowlist is fail-closed and must be provisioned separately.
 * This endpoint cannot mark scans or provenance as passed; those are independent
 * evidence fields populated only by their respective verification processes.
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
  if (input.action === "verify_publisher") {
    if (typeof input.publisherId !== "string" || !UUID.test(input.publisherId)) {
      return privateJson({ error: "A valid publisherId is required." }, 400);
    }
    if (typeof input.evidenceReference !== "string"
      || input.evidenceReference.trim().length < 12
      || input.evidenceReference.trim().length > 2048
      || !/^https:\/\//i.test(input.evidenceReference.trim())) {
      return privateJson({ error: "A secure evidence reference is required for publisher verification." }, 400);
    }

    const admin = createAdminClient();
    const { data: publisher, error: lookupError } = await admin
      .from("node_publishers")
      .select("id, slug, display_name, verification_status")
      .eq("id", input.publisherId)
      .maybeSingle();
    if (lookupError) {
      console.error("Platform publisher lookup failed:", lookupError.code);
      return privateJson({ error: "Could not load publisher for review." }, 500);
    }
    if (!publisher) return privateJson({ error: "Publisher not found." }, 404);
    if (publisher.verification_status !== "pending") {
      return privateJson({ error: "Only pending publishers can be verified through this action." }, 409);
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("node_publishers")
      .update({ verification_status: "verified", verified_at: now, verified_by: reviewer.user.id })
      .eq("id", publisher.id)
      .eq("verification_status", "pending");
    if (updateError) {
      console.error("Platform publisher verification failed:", updateError.code);
      return privateJson({ error: "Could not record publisher verification." }, 500);
    }

    const { error: auditError } = await admin.from("node_platform_audit_events").insert({
      actor_user_id: reviewer.user.id,
      event_type: "node.publisher_verified",
      resource_type: "node_publisher",
      resource_id: publisher.id,
      metadata: {
        publisher_slug: publisher.slug,
        evidence_reference: input.evidenceReference.trim(),
        verification_method: "manual_platform_review",
      },
    });
    if (auditError) {
      console.error("Platform publisher audit insert failed:", auditError.code);
      return privateJson({ error: "Publisher state changed but audit recording failed; stop and reconcile before retrying." }, 500);
    }
    return privateJson({ publisher: { id: publisher.id, status: "verified" } });
  }

  if (input.action === "approve_version") {
    if (typeof input.versionId !== "string" || !UUID.test(input.versionId)) {
      return privateJson({ error: "A valid versionId is required." }, 400);
    }
    const admin = createAdminClient();
    const { data: version, error: lookupError } = await admin
      .from("node_package_versions")
      .select("id, package_id, version, artifact_integrity, publisher_provenance_verified, dependency_scan_status, malware_scan_status, permissions_reviewed_at, review_status")
      .eq("id", input.versionId)
      .maybeSingle();
    if (lookupError) {
      console.error("Platform version lookup failed:", lookupError.code);
      return privateJson({ error: "Could not load package version for review." }, 500);
    }
    if (!version) return privateJson({ error: "Package version not found." }, 404);
    if (version.review_status !== "pending_review") {
      return privateJson({ error: "Only pending package versions can be approved." }, 409);
    }

    const { data: nodePackage, error: packageError } = await admin
      .from("node_packages")
      .select("id, package_name, publisher_id, status")
      .eq("id", version.package_id)
      .maybeSingle();
    if (packageError) return privateJson({ error: "Could not load package metadata." }, 500);
    if (!nodePackage || nodePackage.status !== "active") {
      return privateJson({ error: "Package is not active." }, 409);
    }
    const { data: publisher, error: publisherError } = await admin
      .from("node_publishers")
      .select("id, verification_status")
      .eq("id", nodePackage.publisher_id)
      .maybeSingle();
    if (publisherError) return privateJson({ error: "Could not load publisher status." }, 500);

    const missing: string[] = [];
    if (publisher?.verification_status !== "verified") missing.push("verified_publisher");
    if (!version.publisher_provenance_verified) missing.push("publisher_provenance");
    if (version.dependency_scan_status !== "passed") missing.push("dependency_scan");
    if (version.malware_scan_status !== "passed") missing.push("malware_scan");
    if (!version.permissions_reviewed_at) missing.push("permission_review");
    if (missing.length) return privateJson({ error: "Package approval gates are incomplete.", missing }, 409);

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("node_package_versions")
      .update({ review_status: "approved", approved_at: now, approved_by: reviewer.user.id })
      .eq("id", version.id)
      .eq("review_status", "pending_review");
    if (updateError) {
      console.error("Platform package approval failed:", updateError.code);
      return privateJson({ error: "Could not record package approval." }, 500);
    }

    const { error: auditError } = await admin.from("node_platform_audit_events").insert({
      actor_user_id: reviewer.user.id,
      event_type: "node.version_approved",
      resource_type: "node_package_version",
      resource_id: version.id,
      metadata: {
        package_name: nodePackage.package_name,
        package_version: version.version,
        artifact_integrity: version.artifact_integrity,
        approval_method: "manual_platform_review",
      },
    });
    if (auditError) {
      console.error("Platform approval audit insert failed:", auditError.code);
      return privateJson({ error: "Package state changed but audit recording failed; stop and reconcile before retrying." }, 500);
    }
    return privateJson({ version: { id: version.id, status: "approved" } });
  }

  return privateJson({ error: "Unsupported platform review action." }, 400);
}
