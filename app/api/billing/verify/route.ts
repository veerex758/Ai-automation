import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { isVerifiedPayment } from "@/lib/billing/paystack";

export const runtime = "nodejs";

type PaystackVerifyResponse = {
  status?: boolean;
  data?: {
    id?: unknown;
    reference?: unknown;
    status?: unknown;
    amount?: unknown;
    currency?: unknown;
    paid_at?: unknown;
  };
};

export async function POST(request: Request) {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const body = await request.json();
    const reference = typeof body?.reference === "string" ? body.reference : "";
    if (!/^aivanta_[a-z0-9]+_[a-f0-9]{24}$/.test(reference)) {
      return NextResponse.json({ error: "Invalid reference." }, { status: 400 });
    }

    const workspace = await getOrCreateDefaultWorkspace(client);
    const admin = createAdminClient();
    const { data: payment, error } = await admin.from("billing_payments")
      .select("id, reference, amount_minor, currency")
      .eq("reference", reference)
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404 });

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return NextResponse.json({ error: "Payment provider unavailable." }, { status: 503 });

    const response = await fetch(
      "https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference),
      { headers: { Authorization: "Bearer " + secret }, cache: "no-store" },
    );
    const result = await response.json() as PaystackVerifyResponse;
    if (!response.ok || result.status !== true || !result.data
      || !isVerifiedPayment(result.data, { amountMinor: payment.amount_minor, currency: payment.currency })) {
      return NextResponse.json({ error: "Payment is not verified as successful." }, { status: 409 });
    }

    const transactionId = result.data.id;
    if (!Number.isSafeInteger(transactionId) || Number(transactionId) <= 0
      || result.data.reference !== reference) {
      return NextResponse.json({ error: "Invalid provider verification response." }, { status: 422 });
    }

    const paidAt = typeof result.data.paid_at === "string" ? result.data.paid_at : new Date().toISOString();
    const { error: settlementError } = await admin.rpc("process_paystack_payment", {
      p_reference: reference,
      p_event_key: "transaction.verify:" + reference + ":" + String(transactionId),
      p_event_type: "transaction.verify",
      p_transaction_id: Number(transactionId),
      p_paid_at: paidAt,
    });
    if (settlementError) throw settlementError;

    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Payment verification failed:", error);
    return NextResponse.json({ error: "Could not verify payment." }, { status: 500 });
  }
}
