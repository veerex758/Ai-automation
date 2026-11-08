import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });

    const client = supabase as unknown as { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
    const { data, error } = await client.rpc("marketplace_creator_earnings_summary");
    if (error) {
      if (error.message.includes("creator_not_eligible")) return NextResponse.json({ error: "A verified creator profile is required." }, { status: 403, headers });
      throw error;
    }
    return NextResponse.json({ earnings: Array.isArray(data) ? data[0] ?? null : data }, { headers });
  } catch (error) {
    console.error("Marketplace creator earnings lookup failed", error);
    return NextResponse.json({ error: "Could not load creator earnings." }, { status: 500, headers });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096) return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400, headers });
    const input = body as Record<string, unknown>;
    const amount = input.amount_minor;
    const key = input.idempotency_key;
    if (!Number.isSafeInteger(amount) || (amount as number) <= 0 || typeof key !== "string" || key.trim().length < 8 || key.length > 128) {
      return NextResponse.json({ error: "Provide a positive integer amount_minor and an 8–128 character idempotency_key." }, { status: 400, headers });
    }
    const client = supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
    const { data, error } = await client.rpc("marketplace_request_payout", { p_amount_minor: amount, p_idempotency_key: key.trim() });
    if (error) {
      const status = /creator_not_eligible|payout_onboarding_incomplete/.test(error.message) ? 403 : /insufficient_available_balance/.test(error.message) ? 409 : /invalid_payout_request/.test(error.message) ? 400 : 500;
      if (status === 500) console.error("Marketplace payout request failed", error);
      return NextResponse.json({ error: status === 403 ? "Creator verification or payout onboarding is incomplete." : status === 409 ? "Requested amount exceeds available balance." : status === 400 ? "Invalid payout request." : "Could not submit payout request." }, { status, headers });
    }
    return NextResponse.json({ payout_request_id: data, status: "requested", message: "Payout request recorded; no transfer has been initiated." }, { status: 201, headers });
  } catch (error) {
    console.error("Marketplace payout request failed", error);
    return NextResponse.json({ error: "Could not submit payout request." }, { status: 500, headers });
  }
}
