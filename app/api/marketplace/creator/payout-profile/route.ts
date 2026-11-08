import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };
type RpcClient = { rpc: (name: string) => Promise<{ data: unknown; error: { message: string } | null }> };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const { data, error } = await (supabase as unknown as RpcClient).rpc("marketplace_my_payout_profile");
    if (error) throw error;
    return NextResponse.json({ profile: Array.isArray(data) ? data[0] ?? null : data }, { headers });
  } catch (error) {
    console.error("Marketplace payout profile lookup failed", error);
    return NextResponse.json({ error: "Could not load payout onboarding status." }, { status: 500, headers });
  }
}
