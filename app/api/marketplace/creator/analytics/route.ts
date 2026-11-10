import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };
type RpcClient = { rpc: (name: string) => Promise<{ data: unknown; error: { message: string } | null }> };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const { data, error } = await (supabase as unknown as RpcClient).rpc("marketplace_my_creator_analytics");
    if (error) throw error;
    return NextResponse.json({ analytics: Array.isArray(data) ? data[0] ?? null : data }, { headers });
  } catch (error) {
    console.error("Marketplace creator analytics lookup failed", error);
    return NextResponse.json({ error: "Could not load creator analytics." }, { status: 500, headers });
  }
}
