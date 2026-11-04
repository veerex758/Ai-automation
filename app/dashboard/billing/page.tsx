import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaidPlan } from "@/lib/billing/paystack";
import BillingClient, { type BillingPayment, type WorkspaceSubscription } from "./billing-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return <p>Sign in to manage billing.</p>;

  const workspace = await getOrCreateDefaultWorkspace(client);
  let subscription: WorkspaceSubscription | null = null;
  let payments: BillingPayment[] = [];
  try {
    const admin = createAdminClient();
    const [subscriptionResult, paymentsResult] = await Promise.all([
      admin.from("workspace_subscriptions").select("*").eq("workspace_id", workspace.id).maybeSingle(),
      admin.from("billing_payments").select("id,plan_slug,amount_minor,currency,status,created_at")
        .eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(10),
    ]);
    if (subscriptionResult.error || paymentsResult.error) throw new Error("Billing records unavailable.");
    subscription = subscriptionResult.data;
    payments = paymentsResult.data || [];
  } catch (error) {
    console.error("Unable to load workspace billing:", error);
  }

  const paidPlan = getPaidPlan("pro-monthly");
  const plans = [
    { slug: "starter", name: "Starter", description: "Essential workspace tools.", amountMinor: 0, currency: "NGN" },
    {
      slug: "pro-monthly",
      name: "Pro",
      description: paidPlan ? "More capacity for growing automation." : "Pricing is being configured. Checkout is not yet available.",
      amountMinor: paidPlan?.amountMinor ?? 0,
      currency: paidPlan?.currency ?? "NGN",
      checkoutEnabled: Boolean(paidPlan),
    },
  ];
  return <BillingClient plans={plans} subscription={subscription} payments={payments} />;
}
