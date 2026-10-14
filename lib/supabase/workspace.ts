import type { SupabaseClient, User } from "@supabase/supabase-js";

export type WorkspaceSummary = {
  id: string;
  name: string;
};

async function ensureOwnerMembership(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { data: membership, error: membershipLookupError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipLookupError) throw membershipLookupError;
  if (membership) return;

  const { error: membershipInsertError } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });

  if (!membershipInsertError) return;

  // Another concurrent request may have repaired/created this membership after
  // our lookup. Confirm the invariant before treating a duplicate-key error as safe.
  if (membershipInsertError.code === "23505") {
    const { data: racedMembership, error: racedLookupError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (racedLookupError) throw racedLookupError;
    if (racedMembership) return;
  }

  throw membershipInsertError;
}

export async function getOrCreateDefaultWorkspace(
  supabase: SupabaseClient,
  user: User,
): Promise<WorkspaceSummary> {
  const { data: existing, error: lookupError } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing) {
    await ensureOwnerMembership(supabase, existing.id, user.id);
    return existing;
  }

  const metadataName = typeof user.user_metadata?.full_name === "string"
    ? user.user_metadata.full_name.trim().slice(0, 100)
    : "";
  const baseName = metadataName || "My";
  const { data: created, error: createError } = await supabase
    .from("workspaces")
    .insert({ name: `${baseName}'s workspace`, owner_id: user.id })
    .select("id, name")
    .single();

  if (createError) throw createError;

  await ensureOwnerMembership(supabase, created.id, user.id);
  return created;
}
