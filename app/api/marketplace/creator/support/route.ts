import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };
type RpcClient = { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const { data, error } = await (supabase as unknown as RpcClient).rpc("marketplace_my_creator_support_cases");
    if (error) throw error;
    return NextResponse.json({ cases: data ?? [] }, { headers });
  } catch (error) {
    console.error("Marketplace creator support lookup failed", error);
    return NextResponse.json({ error: "Could not load creator support cases." }, { status: 500, headers });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 8192) return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400, headers });
    const input = body as Record<string, unknown>;
    const category = input.category, subject = input.subject, description = input.description, key = input.idempotency_key;
    const payoutId = input.related_payout_request_id ?? null;
    if (!["payout","tax","verification","ledger","account","other"].includes(String(category)) ||
      typeof subject !== "string" || subject.trim().length < 8 || subject.length > 160 ||
      typeof description !== "string" || description.trim().length < 20 || description.length > 5000 ||
      typeof key !== "string" || key.trim().length < 8 || key.length > 128 ||
      (payoutId !== null && (typeof payoutId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(payoutId)))) {
      return NextResponse.json({ error: "Invalid support case fields." }, { status: 400, headers });
    }
    const { data, error } = await (supabase as unknown as RpcClient).rpc("marketplace_create_creator_support_case", {
      p_category: category, p_subject: subject.trim(), p_description: description.trim(),
      p_related_payout_request_id: payoutId, p_idempotency_key: key.trim(),
    });
    if (error) {
      const status = /creator_not_eligible/.test(error.message) ? 403 : /support_payout_not_found/.test(error.message) ? 404 : /support_idempotency_conflict/.test(error.message) ? 409 : /invalid_creator_support_case/.test(error.message) ? 400 : 500;
      if (status === 500) console.error("Marketplace creator support creation failed", error);
      return NextResponse.json({ error: status === 403 ? "Verified creator account required." : status === 404 ? "Related payout request not found." : status === 409 ? "Idempotency key was already used for different case details." : status === 400 ? "Invalid support case." : "Could not submit support case." }, { status, headers });
    }
    return NextResponse.json({ case_id: data, status: "submitted" }, { status: 201, headers });
  } catch (error) {
    console.error("Marketplace creator support creation failed", error);
    return NextResponse.json({ error: "Could not submit support case." }, { status: 500, headers });
  }
}
