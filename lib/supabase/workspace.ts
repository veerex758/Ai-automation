import type { SupabaseClient, User } from "@supabase/supabase-js";

export type WorkspaceSummary = {
  id: string;
  name: string;
};

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
    const { data: membership, error: membershipLookupError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", existing.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipLookupError) throw membershipLookupError;
    if (!membership) {
      const { error: membershipInsertError } = await supabase
        .from("workspace_members")
        .upsert(
          { workspace_id: existing.id, user_id: user.id, role: "owner" },
          { onConflict: "workspace_id,user_id", ignoreDuplicates: true },
        );
      if (membershipInsertError) throw membershipInsertError;
    }

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

  const { error: membershipError } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: created.id, user_id: user.id, role: "owner" });

  if (membershipError) throw membershipError;
  return created;
}
