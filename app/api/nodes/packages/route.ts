import { NextResponse } from "next/server";
import { resolveNodeWorkspaceAccess } from "@/lib/nodes/workspace-access";

export const dynamic = "force-dynamic";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Lists only platform-approved versions from the authenticated user's RLS-scoped registry view. */
export async function GET() {
  try {
    const access = await resolveNodeWorkspaceAccess();
    if (!access.ok) return privateJson({ error: access.error }, access.status);

    const { data: versions, error: versionError } = await access.supabase
      .from("node_package_versions")
      .select("id, package_id, version, runtime_api_version, manifest, review_status")
      .eq("review_status", "approved")
      .order("created_at", { ascending: false })
      .limit(100);
    if (versionError) throw versionError;
    if (!versions?.length) return privateJson({ packages: [] });

    const packageIds = [...new Set(versions.map((version) => version.package_id))];
    const { data: packages, error: packageError } = await access.supabase
      .from("node_packages")
      .select("id, publisher_id, package_name, display_name, description, status")
      .in("id", packageIds)
      .eq("status", "active");
    if (packageError) throw packageError;
    if (!packages?.length) return privateJson({ packages: [] });

    const publisherIds = [...new Set((packages ?? []).map((item) => item.publisher_id))];
    const { data: publishers, error: publisherError } = await access.supabase
      .from("node_publishers")
      .select("id, display_name, verification_status")
      .in("id", publisherIds)
      .eq("verification_status", "verified");
    if (publisherError) throw publisherError;
    if (!publishers?.length) return privateJson({ packages: [] });

    const packageById = new Map((packages ?? []).map((item) => [item.id, item]));
    const publisherById = new Map((publishers ?? []).map((item) => [item.id, item]));
    return privateJson({
      packages: versions.flatMap((version) => {
        const item = packageById.get(version.package_id);
        const publisher = item ? publisherById.get(item.publisher_id) : null;
        if (!item || !publisher) return [];
        const manifest = version.manifest as { permissions?: unknown };
        return [{
          packageVersionId: version.id,
          packageName: item.package_name,
          displayName: item.display_name,
          description: item.description,
          version: version.version,
          runtimeApiVersion: version.runtime_api_version,
          publisher: publisher.display_name,
          permissions: Array.isArray(manifest.permissions) ? manifest.permissions.filter((value): value is string => typeof value === "string") : [],
        }];
      }),
    });
  } catch (error) {
    console.error("Failed to load approved community node packages:", error);
    return privateJson({ error: "Could not load approved community node packages." }, 500);
  }
}
