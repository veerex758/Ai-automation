import { NextRequest, NextResponse } from "next/server";
import { canManageNodeInstallations, resolveNodeWorkspaceAccess } from "@/lib/nodes/workspace-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION = /^[a-z][a-z0-9_.:-]{1,127}$/;

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function changePermission(
  request: NextRequest,
  context: { params: Promise<{ installationId: string }> },
  action: "grant" | "revoke",
) {
  try {
    const { installationId } = await context.params;
    if (!UUID.test(installationId)) return privateJson({ error: "Invalid installation ID." }, 400);

    const access = await resolveNodeWorkspaceAccess();
    if (!access.ok) return privateJson({ error: access.error }, access.status);
    if (!canManageNodeInstallations(access.role)) {
      return privateJson({ error: "Only workspace owners and admins can manage node permissions." }, 403);
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
    const permission = (body as Record<string, unknown>).permission;
    if (typeof permission !== "string" || !PERMISSION.test(permission)) {
      return privateJson({ error: "A valid permission name is required." }, 400);
    }

    const { data: changed, error } = await access.supabase.rpc(
      "set_workspace_node_permission",
      {
        p_installation_id: installationId,
        p_permission: permission,
        p_action: action,
      },
    );
    if (error) {
      const responseStatus = error.code === "42501" ? 403
        : error.code === "P0002" ? 404
        : error.code === "22023" ? 400 : 500;
      if (responseStatus === 500) console.error("Node permission change failed:", error.code);
      return privateJson({
        error: responseStatus === 403
          ? "Workspace administrator access required."
          : responseStatus === 404
            ? "Installation not found."
            : responseStatus === 400
              ? "The permission is not declared or the installation cannot be changed."
              : "Could not update this permission.",
      }, responseStatus);
    }

    return privateJson({
      installationId,
      permission,
      action,
      changed: Boolean(changed),
    });
  } catch (error) {
    console.error("Failed to change node permission:", error);
    return privateJson({ error: "Could not update this node permission." }, 500);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ installationId: string }> },
) {
  return changePermission(request, context, "grant");
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ installationId: string }> },
) {
  return changePermission(request, context, "revoke");
}
