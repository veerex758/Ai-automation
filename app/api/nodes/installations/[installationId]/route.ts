import { NextRequest, NextResponse } from "next/server";
import { canManageNodeInstallations, resolveNodeWorkspaceAccess } from "@/lib/nodes/workspace-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ installationId: string }> },
) {
  try {
    const { installationId } = await context.params;
    if (!UUID.test(installationId)) return privateJson({ error: "Invalid installation ID." }, 400);

    const access = await resolveNodeWorkspaceAccess();
    if (!access.ok) return privateJson({ error: access.error }, access.status);
    if (!canManageNodeInstallations(access.role)) {
      return privateJson({ error: "Only workspace owners and admins can manage node installations." }, 403);
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

    const status = (body as Record<string, unknown>).status;
    if (status !== "disabled" && status !== "uninstalled") {
      return privateJson({
        error: "Only disable and uninstall are available. Activation is blocked until the isolated worker is ready.",
      }, 400);
    }

    const { data: changed, error } = await access.supabase.rpc(
      "set_workspace_node_installation_state",
      { p_installation_id: installationId, p_status: status },
    );
    if (error) {
      const responseStatus = error.code === "42501" ? 403
        : error.code === "P0002" ? 404
        : error.code === "22023" ? 400 : 500;
      if (responseStatus === 500) console.error("Node installation state change failed:", error.code);
      return privateJson({
        error: responseStatus === 403
          ? "Workspace administrator access required."
          : responseStatus === 404
            ? "Installation not found."
            : responseStatus === 400
              ? "This installation state change is not allowed."
              : "Could not update this installation.",
      }, responseStatus);
    }

    return privateJson({
      installationId,
      status,
      changed: Boolean(changed),
    });
  } catch (error) {
    console.error("Failed to update node installation:", error);
    return privateJson({ error: "Could not update this node installation." }, 500);
  }
}
