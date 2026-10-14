# Staging Auth Acceptance Checklist

This checklist is for the **isolated Aivanta staging project only**. It records operator-owned checks that cannot be proven by local migration replay or static code review. Do not copy credentials, session cookies, access tokens, or secret values into this document, CI logs, issues, or chat.

## 1. Confirm the environment before signing in

- [ ] Confirm the Vercel deployment is a Preview/staging deployment and Vercel Deployment Protection remains enabled.
- [ ] In Vercel's Preview environment settings, confirm `NEXT_PUBLIC_SUPABASE_URL` points to the approved isolated staging Supabase project (project ref: `ygclofqxtztnynkljipj`).
- [ ] Confirm the Preview publishable key belongs to that same staging project. Record only pass/fail and the project ref; never paste the key.
- [ ] Confirm no production Supabase URL, secret/service-role key, or production-only credential is configured in the Preview environment.
- [ ] If any target or project identity is ambiguous, stop. Do not test against production to resolve ambiguity.

## 2. Review hosted Supabase Auth settings (read-only first)

In the staging Supabase Dashboard, review the hosted Auth settings and record the result in the shared verification ledger without including secrets.

- [ ] Site URL is the approved staging/Preview origin, not localhost or the production origin.
- [ ] Redirect URL allow-list contains only the exact required staging callback URL(s) and required local development URL(s); remove stale or broad wildcard entries only after confirming they are not needed.
- [ ] Email confirmation is enabled for staging sign-up unless the team has explicitly approved a different isolated test setup.
- [ ] Leaked-password protection is enabled where available.
- [ ] Signup policy, password policy, rate limits, and email delivery configuration are reviewed and intentional.
- [ ] SMTP/provider settings are present only if required; do not send a live email until a verified test sender and recipient are approved.
- [ ] Do not change hosted settings blindly. If a setting is missing or unclear, record it as an operator gate and ask for approval before changing it.

The repository's `supabase/config.toml` is primarily local CLI configuration. It is **not proof** of the current hosted Dashboard settings.

## 3. Browser authentication checks (only after authorized Preview access)

Use two owner-controlled test identities and synthetic data only. Do not use real customer accounts or customer data.

- [ ] Signed-out visit to `/dashboard` redirects to `/login`.
- [ ] A safe internal `next` path is preserved after sign-in.
- [ ] External/protocol-relative `next` targets fall back to `/dashboard`; no external redirect occurs.
- [ ] Valid sign-in establishes a session and reaches the expected workspace.
- [ ] Invalid credentials fail without revealing whether an unrelated account exists.
- [ ] Email confirmation flow returns through `/auth/callback` to an approved internal destination.
- [ ] Refreshing a signed-in page preserves a valid session; sign-out removes access to protected pages.
- [ ] An expired/invalid session is rejected by server-side auth checks.
- [ ] User A cannot read, update, or delete User B's workspace/workflows/runs by changing IDs in requests or URLs.
- [ ] Workspace-scoped pages and API routes enforce authorization server-side; hidden UI controls alone do not count as a security check.

Stop and record sanitized evidence if any unauthorized access is observed. Do not probe other tenants or production.

## 4. Evidence and release gate

Record only:
- date/time (UTC), deployment identifier/commit, staging project ref;
- test case ID, pass/fail/blocked, HTTP status or sanitized UI outcome;
- a short sanitized error category when blocked.

Never record passwords, JWTs, cookies, API keys, bypass secrets, raw auth response bodies, or personal test-user details.

**Pass criteria:** all applicable checks above pass; hosted settings have been verified by an authorized operator; workspace isolation is demonstrated with the two approved test identities; no production environment or live workflow was touched.

**Blocked criteria:** protected Preview access, test identities, hosted Auth settings, or approved test email details are unavailable. A blocked test is not a pass.

Keep scheduler/live workflow execution disabled throughout this checklist. This checklist does not authorize production changes or live integration sends.
