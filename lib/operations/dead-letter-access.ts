import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export type DeadLetterOperatorContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string };
  workspace: { id: string; name: string };
};

export type DeadLetterOperatorResolution =
  | { ok: true; context: DeadLetterOperatorContext }
  | { ok: false; response: NextResponse };

export async function resolveDeadLetterOperator(): Promise<DeadLetterOperatorResolution> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  const headers = { "Cache-Control": "private, no-store" };

  if (authError || !user) {
    return { ok: false, response: NextResponse.json({ error: "Authentication required." }, { status: 401, headers }) };
  }

  const workspace = await getOrCreateDefaultWorkspace(supabase);
  const [{ data: owner, error: ownerError }, { data: membership, error: membershipError }] = await Promise.all([
    supabase.from("workspaces").select("owner_id").eq("id", workspace.id).maybeSingle(),
    supabase.from("workspace_members").select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle(),
  ]);
  if (ownerError || membershipError) {
    return { ok: false, response: NextResponse.json({ error: "Workspace permissions could not be verified." }, { status: 503, headers }) };
  }

  // Recovery can create a new execution. Restrict this operator control to
  // workspace owners and admins; ordinary members cannot invoke it.
  if (!owner || (owner.owner_id !== user.id && membership?.role !== "admin")) {
    return { ok: false, response: NextResponse.json({ error: "Workspace owner or admin permission required." }, { status: 403, headers }) };
  }

  return { ok: true, context: { supabase, user: { id: user.id }, workspace } };
}
