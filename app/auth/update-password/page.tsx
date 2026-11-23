"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import "./../login/login.css";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    createClient().auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError || !data.user) {
        router.replace("/login?reason=session-expired&next=/auth/update-password");
        return;
      }
      setReady(true);
      setChecking(false);
    }).catch(() => {
      if (active) router.replace("/login?reason=session-expired&next=/auth/update-password");
    });
    return () => { active = false; };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (password.length < 8 || password.length > 128) {
      setError("Choose a password between 8 and 128 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword("");
      setConfirmation("");
      setNotice("Your password has been updated. You can now continue to your workspace.");
    } catch {
      setError("We couldn’t update your password. The reset link may have expired; request a new one and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <header className="auth-header">
        <Link className="auth-brand" href="/" aria-label="Rexnora home">
          <img src="/rexnora-lockup.svg" alt="Rexnora" style={{ width: "172px", height: "36px", objectFit: "contain" }} />
        </Link>
        <Link className="auth-back" href="/login">Back to sign in</Link>
      </header>
      <section className="auth-layout">
        <div className="auth-story">
          <div className="auth-kicker"><span /> ACCOUNT SECURITY</div>
          <h1>Choose a new<br /><em>password.</em></h1>
          <p>Set a new password to secure access to your Rexnora workspace.</p>
        </div>
        <div className="auth-card">
          <div className="auth-heading">
            <h2>Update password</h2>
            <p>Use at least 8 characters. Your password is sent directly to Supabase Auth.</p>
          </div>
          {checking && <div className="auth-message" role="status">Checking your secure reset session…</div>}
          {ready && !notice && <form className="auth-form" onSubmit={handleSubmit}>
            <label>New password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required /></label>
            <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
            {error && <div className="auth-message auth-error" role="alert">{error}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"} <span>↗</span></button>
          </form>}
          {notice && <div className="auth-message auth-success" role="status">{notice}<p><Link href="/dashboard">Continue to workspace ↗</Link></p></div>}
          {!checking && !ready && !notice && <div className="auth-message auth-error" role="alert">Your reset session is no longer valid. <Link href="/login">Request a new reset link.</Link></div>}
        </div>
      </section>
      <footer className="auth-footer"><span>© {new Date().getFullYear()} Rexnora</span><span>Account security <i /> Control by design</span></footer>
    </main>
  );
}
