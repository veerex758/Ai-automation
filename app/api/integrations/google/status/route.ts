import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership } = await supabase.from("workspace_members").select("role")
      .eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Workspace access required." }, { status: 403 });
    const { data, error: queryError } = await supabase.from("google_connections")
      .select("product,account_email,status,scopes,expires_at,updated_at")
      .eq("workspace_id", workspace.id).order("product");
    if (queryError) throw queryError;
    return NextResponse.json({
      connections: (data ?? []).map((row) => ({
        product: row.product, accountEmail: row.account_email, status: row.status,
        scopes: row.scopes, expiresAt: row.expires_at, updatedAt: row.updated_at,
      })),
      oauthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load Google connections." }, { status: 500 });
  }
}
