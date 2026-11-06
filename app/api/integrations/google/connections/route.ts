import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ error: "Connection storage is not configured for this deployment. Check the server Supabase environment variables.", code: "CONNECTION_STORAGE_NOT_CONFIGURED" }, { status: 503, headers });

    const admin = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await admin.from("google_connections")
      .select("id, product, account_email, scopes, status, expires_at, created_at, updated_at")
      .eq("workspace_id", workspace.id)
      .eq("connected_by", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[connections] Could not query workspace Google connections:", { code: error.code, message: error.message });
      return NextResponse.json({ error: "Aivanta could not read the Google connections table. Check that the staging database migration is applied and the service-role key is configured.", code: "CONNECTION_QUERY_FAILED" }, { status: 503, headers });
    }
    return NextResponse.json({ connections: data ?? [] }, { headers });
  } catch (error) {
    console.error("[connections] Failed to resolve connection list:", error);
    return NextResponse.json({ error: "Aivanta could not resolve your workspace connections. Refresh your session and try again; if this persists, the server logs contain the diagnostic.", code: "CONNECTIONS_UNAVAILABLE" }, { status: 500, headers });
  }
}
