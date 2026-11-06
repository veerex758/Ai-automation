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
    if (authError || !user) {
      return NextResponse.json({ error: "Authentication required.", code: "CONNECTION_AUTH_REQUIRED" }, { status: 401, headers });
    }

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.CODED_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.CODED_SUPABASE_SERVICE_ROLE_KEY ?? process.env.CODED_SUPABASE_SECRET_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Connection storage is not configured for this deployment.", code: "CONNECTION_STORAGE_NOT_CONFIGURED" }, { status: 503, headers });
    }

    const admin = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await admin.from("google_connections")
      .select("id, product, account_email, scopes, status, expires_at, created_at, updated_at")
      .eq("workspace_id", workspace.id)
      .eq("connected_by", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[connections] query failed", { code: error.code, message: error.message });
      return NextResponse.json({
        error: "Aivanta could not read the Google connections table.",
        code: error.code === "PGRST205" || error.code === "42P01" ? "CONNECTION_TABLE_MISSING" : "CONNECTION_QUERY_FAILED",
      }, { status: 503, headers });
    }
    return NextResponse.json({ connections: data ?? [] }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    console.error("[connections] request failed", { detail });
    return NextResponse.json({ error: "Aivanta could not resolve your workspace connections.", code: "CONNECTIONS_UNAVAILABLE" }, { status: 500, headers });
  }
}
