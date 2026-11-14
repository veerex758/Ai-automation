import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "private,no-store" } });
  }

  try {
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data, error } = await supabase.rpc("request_workspace_subscription_cancellation", {
      p_workspace_id: workspace.id,
    });
    if (error) {
      if (error.code === "42501") {
        return NextResponse.json({ error: "Only a workspace owner or admin can manage billing." }, { status: 403 });
      }
      console.error("Workspace subscription cancellation failed:", error);
      return NextResponse.json({ error: "Could not schedule subscription cancellation." }, { status: 503 });
    }
    if (!data?.success) {
      const reason = data?.reason === "subscription_not_found"
        ? "No paid subscription exists for this workspace."
        : "There is no active paid subscription to cancel.";
      return NextResponse.json({ error: reason }, { status: 409, headers: { "Cache-Control": "private,no-store" } });
    }
    return NextResponse.json({ cancellation: data }, { headers: { "Cache-Control": "private,no-store" } });
  } catch (error) {
    console.error("Workspace subscription cancellation failed:", error);
    return NextResponse.json({ error: "Could not schedule subscription cancellation." }, { status: 503 });
  }
}
