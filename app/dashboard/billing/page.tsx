"use client";

import { useCallback, useEffect, useState } from "react";
import "./billing.css";
import BillingCheckout from "./billing-checkout";

type CheckoutOption = { slug: string; amount_minor: number; currency: string };
type Plan = {
  key: string;
  name: string;
  limits: Record<string, number | null>;
  checkout: CheckoutOption[];
};
type Payment = {
  id: string;
  plan_slug: string;
  amount_minor: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
};
type BillingData = {
  subscription: {
    plan_key: string;
    status: string;
    billing_provider?: string | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
  };
  entitlements: {
    plan: string;
    status: string;
    usage: Record<string, number>;
    limits: Record<string, number | null>;
    billing: { checkout_enabled: boolean };
  };
  payments?: Payment[];
  plans: Plan[];
};

const metrics = [
  { key: "workflow_created", label: "Active workflows" },
  { key: "workflow_execution", label: "Workflow executions" },
  { key: "ai_credit", label: "AI credits" },
];

function money(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function date(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/billing", { cache: "no-store" });
      const payload = await response.json() as BillingData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Billing information is unavailable.");
      if (!Array.isArray(payload.plans) || !payload.subscription || !payload.entitlements) {
        throw new Error("Billing returned an incomplete workspace response. Please refresh.");
      }
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load billing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadBilling(); }, [loadBilling]);

  const cancelSubscription = async () => {
    if (!window.confirm("Schedule this workspace subscription to end after the current paid period?")) return;
    setCanceling(true);
    setBillingMessage("");
    setError("");
    try {
      const response = await fetch("/api/billing/cancel", { method: "POST" });
      const payload = await response.json() as { error?: string; cancellation?: { access_until?: string; already_scheduled?: boolean } };
      if (!response.ok) throw new Error(payload.error || "Could not schedule cancellation.");
      setBillingMessage(payload.cancellation?.already_scheduled
        ? "Cancellation is already scheduled."
        : `Automatic renewal is stopped. Your paid access remains available until ${date(payload.cancellation?.access_until)}.`);
      await loadBilling();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not schedule cancellation.");
    } finally {
      setCanceling(false);
    }
  };

  if (loading) {
    return <main className="billing-shell" aria-busy="true">
      <BillingHeader />
      <section className="billing-panel" role="status">Loading your workspace plan and usage…</section>
    </main>;
  }

  if (error || !data) {
    return <main className="billing-shell">
      <BillingHeader />
      <section className="billing-panel billing-error" role="alert">
        <h2>Billing could not be loaded</h2>
        <p>{error || "No billing response was received."}</p>
        <button type="button" onClick={() => void loadBilling()}>Try again</button>
      </section>
    </main>;
  }

  const currentPlan = data.plans.find(plan => plan.key === data.subscription.plan_key);
  const active = data.entitlements.status === "active";

  return <main className="billing-shell">
    <BillingHeader />
    <section className="billing-current" aria-label="Current subscription">
      <div>
        <small>YOUR WORKSPACE PLAN</small>
        <h2>{currentPlan?.name ?? data.subscription.plan_key}</h2>
        <p>
          {data.subscription.status.replaceAll("_", " ")}
          {" · "}{data.subscription.billing_provider ?? "No payment provider"}
          {data.subscription.current_period_end ? ` · Period ends ${date(data.subscription.current_period_end)}` : ""}
          {data.subscription.cancel_at_period_end ? " · Cancellation scheduled" : ""}
        </p>
      </div>
      <span className="billing-chip">{active ? "Access active" : "Access restricted"}</span>
    </section>

    <section className="billing-panel">
      <h2>Usage this month</h2>
      <p>Usage is measured against your workspace entitlements.</p>\n      <p>{data.entitlements.limits.workflow_execution==null?"Custom executions":`${data.entitlements.limits.workflow_execution.toLocaleString()} executions included`} · {data.entitlements.limits.ai_credit==null?"Custom AI credits":`${data.entitlements.limits.ai_credit.toLocaleString()} AI credits included`}</p>
      {metrics.map(metric => {
        const used = Math.max(0, data.entitlements.usage[metric.key] ?? 0);
        const limit = data.entitlements.limits[metric.key];
        const unlimited = limit == null;
        const percent = unlimited || limit <= 0 ? 0 : Math.min(100, Math.round(used / limit * 100));
        return <div className="usage-row" key={metric.key}>
          <div className="usage-label"><strong>{metric.label}</strong><span>{used.toLocaleString()} / {limit == null ? "Custom limit" : limit.toLocaleString()}</span></div>
          <div className="usage-track" aria-label={`${metric.label}: ${used} of ${unlimited ? "unlimited" : limit}`}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>;
      })}
    </section>

    <section className="billing-panel">
      <h2>Choose a plan</h2>
      <p>Checkout is available only for prices configured and verified by Aivanta.</p>
      <div className="billing-plans">
        {data.plans.map(plan => <article className={plan.key === data.subscription.plan_key ? "billing-plan selected" : "billing-plan"} key={plan.key}>
          <h3>{plan.name}</h3>
          <ul>
            <li>{plan.limits.workflow_created == null ? "Unlimited" : plan.limits.workflow_created.toLocaleString()} workflows</li>
            <li>{plan.limits.workflow_execution == null ? "Unlimited" : plan.limits.workflow_execution.toLocaleString()} executions / month</li>
            <li>{plan.limits.ai_credit == null ? "Unlimited" : plan.limits.ai_credit.toLocaleString()} AI credits / month</li>
          </ul>
          {plan.key === data.subscription.plan_key
            ? <span className="billing-current-label">Current plan</span>
            : plan.key === "enterprise"
              ? <span className="billing-current-label">Contact sales for a custom plan</span>
              : plan.checkout.length
                ? plan.checkout.map(option => <div key={option.slug}>
                    <small className="billing-configured-price">{money(option.amount_minor, option.currency)} · {option.slug.endsWith("annual") ? "annual" : "monthly"}</small>
                    <BillingCheckout plan={option.slug} enabled={data.entitlements.billing.checkout_enabled} />
                  </div>)
                : <span className="billing-current-label">Checkout not configured</span>}
        </article>)}
      </div>
      <p className="billing-note">Your plan changes only after payment is verified and settled by the billing service.</p>
    </section>

    <section className="billing-panel">
      <h2>Payment history</h2>
      {data.payments?.length
        ? <div className="billing-payment-list">{data.payments.map(payment => <div className="billing-payment-row" key={payment.id}>
            <div><strong>{payment.plan_slug.replaceAll("-", " ")}</strong><small>{date(payment.created_at)}</small></div>
            <span>{money(payment.amount_minor, payment.currency)}</span>
            <span className={`billing-payment-status ${payment.status}`}>{payment.status.replaceAll("_", " ")}</span>
          </div>)}</div>
        : <p>No payments have been recorded for this workspace yet.</p>}
    </section>
  </main>;
}

function BillingHeader() {
  return <header>
    <span className="billing-eyebrow">AIVANTA / WORKSPACE</span>
    <h1>Plan &amp; usage</h1>
    <p>Understand your usage, manage your subscription, and upgrade securely.</p>
  </header>;
}
