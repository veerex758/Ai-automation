# Aivanta product roadmap

Aivanta is being built as a staged business automation platform: dependable conventional workflows first, carefully bounded live integrations next, and AI-assisted automation only when the safety controls are ready.

## Delivery levels

### Level 1 — Application foundation: complete
- [x] Next.js + TypeScript application shell.
- [x] Responsive marketing experience and authenticated dashboard shell.
- [x] CI checks for tests, lint, type-check, and production build.

### Level 2 — Workspace and visual workflow builder: complete
- [x] Supabase Auth with server-side session validation.
- [x] Workspace-scoped workflow persistence and visual builder.
- [x] Workflow validation and version history foundation.
- [x] Premium responsive design system.

### Level 3 — Database security: complete
- [x] Dedicated Aivanta Supabase project and schema migrations.
- [x] Row Level Security for workspace, workflow, and run-history data.
- [x] Security hardening and advisor checks.

### Level 4 — Automated workflow tests: complete
- [x] Workflow definition validation tests.
- [x] Dry-run execution tests and safe condition evaluation.
- [x] Automated CI verification.

### Level 5 — Workflow execution engine: complete for MVP scope
- [x] Persisted dry-run results and workflow run history.
- [x] Step-by-step outcomes without performing external side effects.
- [x] Version and status metadata for workflow runs.

### Level 6 — First live integration: implementation complete
- [x] Server-only Resend adapter and guarded live-run endpoint.
- [x] Explicit activation flag, approved-recipient allowlist, and per-user rate limit.
- [x] Idempotency, sanitized provider errors, and run/step persistence.
- [ ] Verify a real email in staging using a verified sender and an inbox controlled by the project owner.

### Level 7 — Security and end-to-end verification: automated checks complete
- [x] Scope idempotency lookups to the authenticated user and requested workflow.
- [x] Enforce run-step ownership and mode/status restrictions in RLS.
- [x] Allow in-progress runs to have a null completion timestamp.
- [x] Expand dry-run, provider redirect, and security migration tests.
- [x] Supabase security advisor returned no lints.
- [x] Main-branch CI previously passed tests, lint, type-check, and production build.
- [ ] Complete the documented staging end-to-end checks, including auth, cross-workspace access, and one approved test email.

### Level 8 — Deployment and MVP launch: in progress
- [x] Add a minimal health endpoint at `/api/health`.
- [x] Document hosting environment variables, Auth redirect setup, staging smoke tests, and launch gates.
- [x] Configure the Vercel project and confirm a production deployment is READY.
- [ ] Verify the canonical production URL and configure/confirm the Supabase Auth redirect allow-list.
- [ ] Run staging smoke tests and verify workflow run history.
- [ ] Review operational monitoring, backup/recovery expectations, and production safety settings.
- [ ] Obtain explicit launch approval before enabling live email in production.

## Current operating limits

- Live execution is disabled unless the server environment explicitly sets `AIVANTA_LIVE_EXECUTION_ENABLED=true`.
- The first live path supports manual-trigger workflows with exactly one email action.
- The recipient must be present in the server-side `AIVANTA_LIVE_EMAIL_RECIPIENTS` allowlist.
- Slack, webhooks, scheduled triggers, and other action types remain dry-run only.
- A successful deployment does not prove production authentication, staging behavior, or real email delivery.

## Engineering principles

- Security and tenant isolation are architectural requirements, not marketing claims.
- Never store secrets in source control or return provider tokens to the browser.
- Validate workflow definitions and authorize every execution server-side.
- Treat external service output as untrusted input.
- Prefer transparent, bounded workflows before open-ended autonomous behavior.
- Clearly distinguish implemented features from staging-verified and production-launched features.
