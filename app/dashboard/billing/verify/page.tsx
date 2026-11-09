"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function VerifyPayment() {
  const params = useSearchParams();
  const reference = params.get("reference");
  const [message, setMessage] = useState("Verifying payment securely…");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!reference) {
      setError(true);
      setMessage("Payment reference is missing.");
      return;
    }
    let cancelled = false;
    fetch("/api/billing/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference }),
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Verification failed.");
        return result;
      })
      .then(() => {
        if (!cancelled) setMessage("Payment verified. Your workspace plan is updated.");
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(true);
          setMessage(cause instanceof Error ? cause.message : "Verification failed.");
        }
      });
    return () => { cancelled = true; };
  }, [reference]);

  return (
    <main className="dashboard-content">
      <h1>{error ? "Payment not confirmed" : "Payment verification"}</h1>
      <p role="status">{message}</p>
      <Link href="/dashboard/billing">Return to billing</Link>
    </main>
  );
}

export default function VerifyPage() {
  return <Suspense fallback={<main className="dashboard-content"><p>Loading payment status…</p></main>}><VerifyPayment /></Suspense>;
}
