import type { SupabaseClient } from "@supabase/supabase-js";
import { redactSensitiveData } from "@/lib/integrations/redact-sensitive";

type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const definitions: ToolDefinition[] = [
  {
    id: "workflow.list",
    name: "workflow_list",
    description: "List workflows in the current workspace. Read-only.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "active", "paused", "archived"], description: "Optional workflow status filter." },
      },
    },
  },
  {
    id: "workflow.get",
    name: "workflow_get",
    description: "Read one workflow in the current workspace by its UUID. Read-only.",
    parameters: {
      type: "object",
      properties: { workflow_id: { type: "string", description: "Workflow UUID." } },
      required: ["workflow_id"],
    },
  },
  {
    id: "integrations.list",
    name: "integration_list",
    description: "List connected integrations and verification status for the current workspace. Never returns credentials or tokens.",
    parameters: { type: "object", properties: {} },
  },
];

const byId = new Map(definitions.map((tool) => [tool.id, tool]));
const byName = new Map(definitions.map((tool) => [tool.name, tool]));

export function getAgentTools(ids: string[]) {
  const selected = [...new Set(ids)];
  const unknown = selected.filter((id) => !byId.has(id));
  if (unknown.length) throw new Error("AGENT_TOOL_NOT_ALLOWED");
  return selected.map((id) => byId.get(id)!);
}

export function getAgentToolByName(name: string) {
  return byName.get(name);
}

export async function executeAgentTool(
  supabase: SupabaseClient,
  workspaceId: string,
  toolId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (toolId === "workflow.list") {
    const status = args.status;
    if (status !== undefined && !["draft", "active", "paused", "archived"].includes(String(status))) {
      throw new Error("AGENT_TOOL_INVALID_ARGUMENT");
    }
    let query = supabase.from("workflows")
      .select("id,name,description,status,version,updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }).limit(20);
    if (typeof status === "string") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw new Error("AGENT_TOOL_QUERY_FAILED");
    return { workflows: data ?? [] };
  }

  if (toolId === "workflow.get") {
    const id = typeof args.workflow_id === "string" ? args.workflow_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("AGENT_TOOL_INVALID_ARGUMENT");
    }
    const { data, error } = await supabase.from("workflows")
      .select("id,name,description,status,version,definition")
      .eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
    if (error) throw new Error("AGENT_TOOL_QUERY_FAILED");
    if (!data) return { found: false };
    return redactSensitiveData({ found: true, workflow: data }) as Record<string, unknown>;
  }

  if (toolId === "integrations.list") {
    const [workspace, google] = await Promise.all([
      supabase.from("workspace_integrations")
        .select("provider,status,last_test_status,updated_at")
        .eq("workspace_id", workspaceId).order("provider", { ascending: true }).limit(100),
      supabase.from("google_connections")
        .select("product,status,scopes,expires_at,updated_at")
        .eq("workspace_id", workspaceId).order("product", { ascending: true }).limit(20),
    ]);
    if (workspace.error || google.error) throw new Error("AGENT_TOOL_QUERY_FAILED");
    return {
      integrations: (workspace.data ?? []).map((item) => ({
        provider: item.provider, status: item.status, last_test_status: item.last_test_status, updated_at: item.updated_at,
      })),
      google_connections: (google.data ?? []).map((item) => ({
        product: item.product, status: item.status, scopes: item.scopes, expires_at: item.expires_at, updated_at: item.updated_at,
      })),
    };
  }

  throw new Error("AGENT_TOOL_NOT_ALLOWED");
}
