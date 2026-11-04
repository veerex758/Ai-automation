import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPaystackSignature, isVerifiedPayment } from "@/lib/billing/paystack";

export const runtime = "nodejs";

type PaystackChargeSuccess = {
  event?: string;
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
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "Webhook unavailable." }, { status: 503 });

  const raw = await request.text();
  if (!isValidPaystackSignature(raw, request.headers.get("x-paystack-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: PaystackChargeSuccess;
  try {
    event = JSON.parse(raw) as PaystackChargeSuccess;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (event.event !== "charge.success" || !event.data?.reference) {
    return NextResponse.json({ received: true });
  }

  try {
    const reference = event.data.reference;
    const transactionId = event.data.id;
    if (typeof reference !== "string" || !Number.isSafeInteger(transactionId) || Number(transactionId) <= 0) {
      return NextResponse.json({ error: "Invalid payment payload." }, { status: 422 });
    }

    const admin = createAdminClient();
    const { data: payment, error } = await admin.from("billing_payments")
      .select("id, reference, amount_minor, currency")
      .eq("reference", reference)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Unable to locate payment." }, { status: 500 });
    if (!payment) return NextResponse.json({ received: true });

    if (!isVerifiedPayment(event.data, { amountMinor: payment.amount_minor, currency: payment.currency })) {
      return NextResponse.json({ error: "Payment details mismatch." }, { status: 422 });
    }

    const paidAt = typeof event.data.paid_at === "string" ? event.data.paid_at : new Date().toISOString();
    const { error: settlementError } = await admin.rpc("process_paystack_payment", {
      p_reference: reference,
      p_event_key: "charge.success:" + reference,
      p_event_type: "charge.success",
      p_transaction_id: Number(transactionId),
      p_paid_at: paidAt,
    });
    if (settlementError) {
      console.error("Atomic Paystack settlement failed:", settlementError);
      return NextResponse.json({ error: "Payment settlement requires retry." }, { status: 500 });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Paystack webhook processing failed:", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
