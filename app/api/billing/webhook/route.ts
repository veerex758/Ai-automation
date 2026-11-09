import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPaystackSignature, isVerifiedPayment } from "@/lib/billing/paystack";

export const runtime = "nodejs";

type PaystackWebhookEvent = {
  event?: string;
  data?: {
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    id?: number;
    paid_at?: string | null;
  };
};

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "Webhook unavailable." }, { status: 503 });

  const raw = await request.text();
  if (!isValidPaystackSignature(raw, request.headers.get("x-paystack-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(raw) as PaystackWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (event.event !== "charge.success" || !event.data?.reference) {
    return NextResponse.json({ received: true });
  }

  try {
    const admin = createAdminClient();
    const { data: payment, error } = await admin.from("billing_payments")
      .select("*").eq("reference", event.data.reference).maybeSingle();
    if (error) return NextResponse.json({ error: "Unable to locate payment." }, { status: 500 });
    if (!payment) return NextResponse.json({ received: true });

    // Validate the signed payload before reserving its idempotency key.
    if (!isVerifiedPayment(event.data, { amountMinor: payment.amount_minor, currency: payment.currency })) {
      return NextResponse.json({ error: "Payment details mismatch." }, { status: 422 });
    }
    if (payment.status === "success") return NextResponse.json({ received: true, alreadyProcessed: true });

    const eventKey = "charge.success:" + payment.reference;
    const { error: eventError } = await admin.from("billing_webhook_events").insert({
      event_key: eventKey,
      event_type: "charge.success",
      reference: payment.reference,
    });
    if (eventError?.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    if (eventError) return NextResponse.json({ error: "Unable to record event." }, { status: 500 });

    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86400000);
    const { data: changed, error: paymentError } = await admin.from("billing_payments")
      .update({
        status: "success",
        provider_transaction_id: event.data.id,
        paid_at: event.data.paid_at || now.toISOString(),
      })
      .eq("id", payment.id).neq("status", "success").select("id").maybeSingle();

    if (paymentError) {
      await admin.from("billing_webhook_events").delete().eq("event_key", eventKey);
      return NextResponse.json({ error: "Unable to update payment." }, { status: 500 });
    }

    if (changed) {
      const { error: subscriptionError } = await admin.from("workspace_subscriptions").upsert({
        workspace_id: payment.workspace_id,
        provider: "paystack",
        plan_slug: payment.plan_slug,
        status: "active",
        currency: payment.currency,
        amount_minor: payment.amount_minor,
        current_period_start: now.toISOString(),
        current_period_end: end.toISOString(),
        last_payment_id: payment.id,
      }, { onConflict: "workspace_id" });
      if (subscriptionError) {
        await admin.from("billing_payments").update({ status: "pending", provider_transaction_id: null, paid_at: null })
          .eq("id", payment.id).eq("status", "success");
        await admin.from("billing_webhook_events").delete().eq("event_key", eventKey);
        return NextResponse.json({ error: "Entitlement update requires retry." }, { status: 500 });
      }
    }

    await admin.from("billing_webhook_events").update({ processed_at: new Date().toISOString() }).eq("event_key", eventKey);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Paystack webhook processing failed:", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
