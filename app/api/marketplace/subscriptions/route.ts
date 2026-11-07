import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };
type RpcClient = { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const { data, error } = await (supabase as unknown as RpcClient).rpc("marketplace_my_subscriptions");
    if (error) throw error;
    return NextResponse.json({ subscriptions: data ?? [] }, { headers });
  } catch (error) {
    console.error("Marketplace subscription lookup failed", error);
    return NextResponse.json({ error: "Could not load subscriptions." }, { status: 500, headers });
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
    const subscriptionId = input.subscription_id;
    const key = input.idempotency_key;
    if (typeof subscriptionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(subscriptionId) ||
        typeof key !== "string" || key.trim().length < 8 || key.length > 128) {
      return NextResponse.json({ error: "Provide a valid subscription_id and an 8–128 character idempotency_key." }, { status: 400, headers });
    }
    const { data, error } = await (supabase as unknown as RpcClient).rpc("marketplace_request_subscription_cancellation", {
      p_subscription_id: subscriptionId, p_idempotency_key: key.trim(),
    });
    if (error) {
      const status = /subscription_not_found/.test(error.message) ? 404 : /subscription_not_cancellable/.test(error.message) ? 409 : /invalid_subscription_cancellation/.test(error.message) ? 400 : 500;
      if (status === 500) console.error("Marketplace cancellation request failed", error);
      return NextResponse.json({ error: status === 404 ? "Subscription not found." : status === 409 ? "Subscription cannot be cancelled in its current state." : status === 400 ? "Invalid cancellation request." : "Could not request cancellation." }, { status, headers });
    }
    return NextResponse.json({ command_id: data, status: "pending", message: "Cancellation request recorded; provider confirmation is pending." }, { status: 202, headers });
  } catch (error) {
    console.error("Marketplace cancellation request failed", error);
    return NextResponse.json({ error: "Could not request cancellation." }, { status: 500, headers });
  }
}
