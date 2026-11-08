import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };
type RpcClient = { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const client = supabase as unknown as RpcClient;
    const [payouts, statements] = await Promise.all([
      client.rpc("marketplace_my_payouts"),
      client.rpc("marketplace_my_creator_statements"),
    ]);
    if (payouts.error || statements.error) throw payouts.error ?? statements.error;
    return NextResponse.json({ payouts: payouts.data ?? [], statements: statements.data ?? [] }, { headers });
  } catch (error) {
    console.error("Marketplace creator payout history lookup failed", error);
    return NextResponse.json({ error: "Could not load payout history and statements." }, { status: 500, headers });
  }
}
