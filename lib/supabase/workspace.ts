import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkspaceSummary = {
  id: string;
  name: string;
};

/**
 * Resolve the signed-in user's default workspace through a transaction-scoped
 * database lock. This keeps concurrent requests from creating duplicate defaults
 * and repairs a missing owner-membership row idempotently.
 */
export async function getOrCreateDefaultWorkspace(
  supabase: SupabaseClient,
): Promise<WorkspaceSummary> {
  const { data, error } = await supabase.rpc("get_or_create_default_workspace");

  if (error) throw error;

  const workspace = Array.isArray(data) ? data[0] : data;
  if (
    !workspace
    || typeof workspace !== "object"
    || !("id" in workspace)
    || !("name" in workspace)
    || typeof workspace.id !== "string"
    || typeof workspace.name !== "string"
  ) {
    throw new Error("Default workspace could not be resolved.");
  }

  return { id: workspace.id, name: workspace.name };
}
