"use client";
import { useState } from "react";

type Plan = { slug: string; name: string; description: string; amountMinor: number; currency: string };
export default function BillingClient({ plans, subscription, payments }: { plans: Plan[]; subscription: any; payments: any[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function checkout(plan: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Checkout failed.");
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout failed.");
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="dash-brand" href="/dashboard">Aivanta</a>
        <nav className="side-nav">
          <a className="side-link" href="/dashboard">Dashboard</a>
          <a className="side-link selected" href="/dashboard/billing">Billing</a>
        </nav>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <strong>Workspace / Billing</strong>
          <span className="environment-badge">Paystack test integration</span>
        </header>
        <div className="dashboard-content section-page-content">
          <div className="welcome-row">
            <div>
              <div className="dash-eyebrow">WORKSPACE BILLING</div>
              <h1>Plans &amp; billing</h1>
              <p>Choose a plan and securely complete checkout with Paystack.</p>
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
          <section className="billing-plan-card">
            <div>
              <div className="dash-eyebrow">CURRENT PLAN</div>
              <h2>{subscription?.plan_slug || "Starter"}</h2>
              <p>{subscription ? `Status: ${subscription.status} · until ${new Date(subscription.current_period_end).toLocaleDateString()}` : "No paid plan is active."}</p>
            </div>
          </section>
          <div className="section-title-row"><h2>Available plans</h2></div>
          <div className="section-cards-grid">
            {plans.map((plan) => (
              <article className="section-info-card" key={plan.slug}>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
                <strong>
                  {plan.amountMinor > 0
                    ? new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency }).format(plan.amountMinor / 100)
                    : plan.slug === "starter" ? "Free" : "Pricing not configured"}
                </strong>
                {plan.amountMinor > 0 && (
                  <button className="create-button" disabled={busy} onClick={() => checkout(plan.slug)}>
                    {busy ? "Starting checkout…" : "Continue to Paystack ↗"}
                  </button>
                )}
              </article>
            ))}
          </div>
          <div className="section-title-row"><h2>Recent payments</h2></div>
          <div className="section-empty-panel">
            {payments.length
              ? payments.map((payment) => <p key={payment.id}>{payment.plan_slug} · {payment.currency} {payment.amount_minor / 100} · {payment.status}</p>)
              : <p>No payment history yet.</p>}
          </div>
          <p className="dashboard-footnote">A redirect from Paystack is not proof of payment. Aivanta grants access only after server-side verification.</p>
        </div>
      </section>
    </main>
  );
}
