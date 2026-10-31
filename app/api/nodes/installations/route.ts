import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateNodePackageManifest } from "@/lib/nodes/package-manifest";
import { canManageNodeInstallations, resolveNodeWorkspaceAccess } from "@/lib/nodes/workspace-access";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET() {
  try {
    const access = await resolveNodeWorkspaceAccess();
    if (!access.ok) return privateJson({ error: access.error }, access.status);

    const { data: installations, error: installationError } = await access.supabase
      .from("workspace_node_installations")
      .select("id, package_version_id, status, installed_by, created_at, updated_at, disabled_at, uninstalled_at")
      .eq("workspace_id", access.workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (installationError) throw installationError;

    const rows = installations ?? [];
    if (rows.length === 0) return privateJson({ installations: [] });

    const installationIds = rows.map((row) => row.id);
    const versionIds = [...new Set(rows.map((row) => row.package_version_id))];

    const [{ data: grants, error: grantsError }, admin] = await Promise.all([
      access.supabase
        .from("workspace_node_permission_grants")
        .select("id, installation_id, permission, status, granted_by, revoked_by, created_at, revoked_at")
        .eq("workspace_id", access.workspaceId)
        .in("installation_id", installationIds)
        .order("created_at", { ascending: true }),
      Promise.resolve(createAdminClient()),
    ]);
    if (grantsError) throw grantsError;

    // Platform metadata is read with the server-only client only after the user's
    // RLS-scoped installation IDs have been resolved for this workspace.
    const { data: versions, error: versionsError } = await admin
      .from("node_package_versions")
      .select("id, package_id, version, review_status")
      .in("id", versionIds);
    if (versionsError) throw versionsError;

    const packageIds = [...new Set((versions ?? []).map((row) => row.package_id))];
    const { data: packages, error: packagesError } = packageIds.length
      ? await admin.from("node_packages")
        .select("id, package_name, display_name, description, status, publisher_id")
        .in("id", packageIds)
      : { data: [], error: null };
    if (packagesError) throw packagesError;

    const publisherIds = [...new Set((packages ?? []).map((row) => row.publisher_id))];
    const { data: publishers, error: publishersError } = publisherIds.length
      ? await admin.from("node_publishers")
        .select("id, display_name, verification_status")
        .in("id", publisherIds)
      : { data: [], error: null };
    if (publishersError) throw publishersError;

    const versionById = new Map((versions ?? []).map((row) => [row.id, row]));
    const packageById = new Map((packages ?? []).map((row) => [row.id, row]));
    const publisherById = new Map((publishers ?? []).map((row) => [row.id, row]));
    const grantsByInstallation = new Map<string, typeof grants>();
    for (const grant of grants ?? []) {
      const existing = grantsByInstallation.get(grant.installation_id) ?? [];
      existing.push(grant);
      grantsByInstallation.set(grant.installation_id, existing);
    }

    return privateJson({
      installations: rows.map((row) => {
        const version = versionById.get(row.package_version_id);
        const nodePackage = version ? packageById.get(version.package_id) : null;
        const publisher = nodePackage ? publisherById.get(nodePackage.publisher_id) : null;
        return {
          id: row.id,
          status: row.status,
          installedAt: row.created_at,
          updatedAt: row.updated_at,
          disabledAt: row.disabled_at,
          uninstalledAt: row.uninstalled_at,
          package: nodePackage ? {
            name: nodePackage.package_name,
            displayName: nodePackage.display_name,
            description: nodePackage.description,
            version: version?.version ?? null,
            registryStatus: nodePackage.status,
            reviewStatus: version?.review_status ?? null,
            publisher: publisher?.display_name ?? "Unknown publisher",
            publisherStatus: publisher?.verification_status ?? "unknown",
          } : null,
          permissions: (grantsByInstallation.get(row.id) ?? []).map((grant) => ({
            id: grant.id,
            name: grant.permission,
            status: grant.status,
            grantedAt: grant.created_at,
            revokedAt: grant.revoked_at,
          })),
        };
      }),
    });
  } catch (error) {
    console.error("Failed to load node installations:", error);
    return privateJson({ error: "Could not load workspace node installations." }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await resolveNodeWorkspaceAccess();
    if (!access.ok) return privateJson({ error: access.error }, access.status);
    if (!canManageNodeInstallations(access.role)) {
      return privateJson({ error: "Only workspace owners and admins can install nodes." }, 403);
    }

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
    if (typeof input.packageVersionId !== "string" || !UUID.test(input.packageVersionId)) {
      return privateJson({ error: "A valid packageVersionId is required." }, 400);
    }
    const requestedPermissions = input.permissions === undefined ? [] : input.permissions;
    if (!Array.isArray(requestedPermissions)
      || requestedPermissions.length > 7
      || requestedPermissions.some((permission) => typeof permission !== "string")
      || new Set(requestedPermissions).size !== requestedPermissions.length) {
      return privateJson({ error: "Permissions must be a unique list of at most seven capability names." }, 400);
    }

    const { data: version, error: versionError } = await access.supabase
      .from("node_package_versions")
      .select("id, package_id, version, artifact_integrity, manifest, review_status")
      .eq("id", input.packageVersionId)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!version || version.review_status !== "approved") {
      return privateJson({ error: "This package version is not approved for installation." }, 404);
    }

    const { data: nodePackage, error: packageError } = await access.supabase
      .from("node_packages")
      .select("id, publisher_id, package_name, status")
      .eq("id", version.package_id)
      .maybeSingle();
    if (packageError) throw packageError;
    if (!nodePackage || nodePackage.status !== "active") {
      return privateJson({ error: "This package is not currently available." }, 409);
    }

    const { data: publisher, error: publisherError } = await access.supabase
      .from("node_publishers")
      .select("id, display_name, verification_status")
      .eq("id", nodePackage.publisher_id)
      .maybeSingle();
    if (publisherError) throw publisherError;
    if (!publisher || publisher.verification_status !== "verified") {
      return privateJson({ error: "This package publisher is not verified." }, 409);
    }

    let manifest;
    try {
      manifest = validateNodePackageManifest(version.manifest);
    } catch {
      return privateJson({ error: "The registry package manifest failed validation." }, 422);
    }
    if (
      manifest.packageName !== nodePackage.package_name
      || manifest.packageVersion !== version.version
      || manifest.integrity !== version.artifact_integrity
      || manifest.publisher.name !== publisher.display_name
    ) {
      return privateJson({ error: "Package metadata does not match its reviewed manifest." }, 409);
    }

    const declaredPermissions = new Set(manifest.permissions);
    if (requestedPermissions.some((permission) => !declaredPermissions.has(permission as string))) {
      return privateJson({ error: "One or more requested capabilities are not declared by this package." }, 400);
    }

    const { data: installationId, error: installError } = await access.supabase.rpc(
      "create_workspace_node_installation",
      {
        p_workspace_id: access.workspaceId,
        p_package_version_id: input.packageVersionId,
        p_permissions: requestedPermissions,
      },
    );
    if (installError) {
      const status = installError.code === "42501" ? 403
        : installError.code === "22023" ? 400
        : installError.code === "P0002" ? 404
        : installError.code === "23505" ? 409 : 500;
      if (status === 500) console.error("Node installation transaction failed:", installError.code);
      return privateJson({
        error: status === 409
          ? "This package version is already installed in the workspace."
          : status === 403
            ? "Workspace administrator access required."
            : status === 400
              ? "The requested capabilities could not be approved."
              : status === 404
                ? "Approved package version not found."
                : "Could not create this node installation.",
      }, status);
    }

    return privateJson({
      installation: {
        id: installationId,
        status: "disabled",
        packageName: nodePackage.package_name,
        packageVersion: version.version,
        permissions: requestedPermissions,
        activation: "blocked_until_isolated_worker",
      },
      message: "Installation and permission consent were saved. Execution remains disabled until the isolated worker is available.",
    }, 201);
  } catch (error) {
    console.error("Failed to create node installation:", error);
    return privateJson({ error: "Could not create this node installation." }, 500);
  }
}
