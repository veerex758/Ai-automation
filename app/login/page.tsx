"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import "./login.css";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          },
        });
        if (authError) throw authError;
        if (data.session) {
          router.replace("/dashboard");
          router.refresh();
        } else {
          setNotice("Check your inbox for the confirmation link to finish creating your account.");
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        const next = searchParams.get("next");
        const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
        router.replace(safeNext);
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't complete that request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-orb auth-orb-one" aria-hidden="true" />
      <div className="auth-orb auth-orb-two" aria-hidden="true" />
      <header className="auth-header">
        <Link className="auth-brand" href="/"><span className="auth-brand-mark">a</span><span>Aivanta<span>.</span></span></Link>
        <Link className="auth-back" href="/">Back to home <span>↗</span></Link>
      </header>

      <section className="auth-layout">
        <div className="auth-story">
          <div className="auth-kicker"><span /> YOUR WORK, MOVING FORWARD</div>
          <h1>Make room for<br /><em>meaningful work.</em></h1>
          <p>A calmer home for your workflows, connected tools, and the ideas that move your business forward.</p>
          <div className="auth-promise">
            <div className="promise-icon">✓</div>
            <div><strong>Built around control</strong><span>Your workspace belongs to you. Access is authenticated and workspace-scoped.</span></div>
          </div>
          <div className="auth-bottom-note"><span>01</span> Thoughtful automation. Real work.</div>
        </div>

        <div className="auth-card">
          <div className="auth-card-top"><span className="auth-card-symbol">✳</span><span className="auth-secure"><i /> SECURE WORKSPACE ACCESS</span></div>
          <div className="auth-heading"><h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2><p>{mode === "signin" ? "Sign in to continue to your workspace." : "Start building a more thoughtful way to work."}</p></div>
          <div className="auth-tabs" role="tablist" aria-label="Account access">
            <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "auth-tab active" : "auth-tab"} onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "auth-tab active" : "auth-tab"} onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>Create account</button>
          </div>
          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === "signup" && <label>Full name<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={100} required /></label>}
            <label>Email address<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required /></label>
            <label>Password<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" minLength={8} maxLength={128} required /></label>
            {error && <div className="auth-message auth-error" role="alert">{error}</div>}
            {notice && <div className="auth-message auth-success" role="status">{notice}</div>}
            {searchParams.get("reason") === "configuration" && <div className="auth-message auth-error" role="alert">Workspace sign-in is not configured yet. Add the Supabase environment variables to your deployment.</div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in to workspace" : "Create account"} <span>↗</span></button>
          </form>
          <div className="auth-card-foot"><span>⌑</span> Your session is protected by Supabase Auth.</div>
        </div>
      </section>
      <footer className="auth-footer"><span>© {new Date().getFullYear()} Aivanta</span><span>Clarity in every step <i /> Control by design</span></footer>
    </main>
  );
}
