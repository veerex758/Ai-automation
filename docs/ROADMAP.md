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

### Phase 9 — AI-assisted workflow drafting: implementation merged
- [x] Authenticated AI workflow draft generation API with strict schema validation.
- [x] Builder preview/review flow; generated drafts are not saved or executed automatically.
- [x] Automated provider-mocked validation, error handling, and safety tests.
- [ ] Verify live AI provider configuration and authenticated end-to-end behavior.

### Phase 10 — Integrations and reusable actions: implementation code-green; browser acceptance pending
- [x] Establish a server-owned reusable action catalog for internal tasks, email, Slack, and HTTPS webhooks.
- [x] Add an authenticated, private/no-store action-catalog endpoint with clear execution capability labels.
- [x] Drive action provider/operation compatibility validation from the shared catalog.
- [x] Connect catalog metadata to builder action selection and configuration UI.
- [x] Preserve generated action provider, operation, and settings when applying AI drafts to the visual builder.
- [x] Validate action field required values, maximum lengths, email formats, and HTTPS URLs before review.
- [ ] Verify the authenticated preview flow in a browser, including unauthenticated catalog rejection and required-field validation.
- [ ] Implement and verify additional live connectors one at a time, with least-privilege credentials, validation, timeouts, rate-limit handling, and sanitized run logs.
- [ ] Keep non-email providers dry-run only until their individual live-path safety checks pass.

### Phase 11 — Reliability, security, and observability: in progress
- [ ] Review and merge the safe request-observability baseline proposed in PR #27.
- [ ] Verify authenticated scheduler behavior and keep scheduled processing dry-run only.
- [ ] Review hosting alerting/log retention and confirm an owner.
- [ ] Review Supabase Auth hardening findings and approve any configuration changes.
- [ ] Confirm backup retention and complete a non-production recovery drill.
- [ ] Complete authenticated staging checks and operational release review.

### Phase 12 — Staging end-to-end verification: in progress
- [x] Add a non-destructive unauthenticated staging smoke-test script with production-host guardrails.
- [x] Document the authenticated browser acceptance matrix and release gates.
- [ ] Run the smoke script against a dedicated staging or Vercel preview deployment.
- [ ] Verify signed-in builder behavior, action validation, AI draft review, and run history.
- [ ] Verify workspace isolation with authorized staging test identities.
- [ ] Record sanitized evidence and resolve failures before calling staging acceptance complete.
- [ ] Keep real email delivery as a separate explicitly approved staging test; no live side effects in the smoke script.

## Supabase staging connection checkpoint — 2026-10-13

- [x] Confirm the dedicated `aivanta-staging` Supabase project is active and healthy (`eu-west-1`).
- [x] Confirm the remote project contains the eight expected public application tables and that Row Level Security is enabled on each.
- [x] Inspect remote policies: access is limited to the `authenticated` role; no table grants to `anon` were found in the public schema.
- [x] Run Supabase security advisors: no security lints were reported.
- [x] Confirm the Vercel project has the staging Supabase URL and publishable key scoped to Preview, while the existing production environment variables remain scoped to Production.
- [x] Confirm the latest Vercel deployment for `staging/aivanta-supabase-rebuild` is READY at commit `30537caf838c6d51b6226b23f21cd0af54dc6d11`.
- [ ] Run the HTTP staging smoke suite and authenticated browser acceptance tests. The latest Vercel staging deployment for commit `30537caf838c6d51b6226b23f21cd0af54dc6d11` is confirmed `READY`. The Vercel project has SSO protection enabled for non-custom domains, so tests must use an approved protected-preview access method rather than weaken deployment protection.
- [x] Confirm the tracked migration chain can be replayed from an empty isolated local Supabase database. The latest replay run completed successfully at staging branch SHA `665a77df361188a22904c86647294d84c05460ba`: https://github.com/veerex758/Ai-automation/actions/runs/38321263853
- [ ] Reconcile remote Supabase migration history before relying on future remote migration automation: the remote migration ledger currently lists 18 entries, while the staging branch tracks 22 SQL migration files with different version/name pairs. This count/name difference is a reconciliation lead, not proof that remote schema objects are missing. Compare each ledger entry and schema change with the tracked SQL before any migration repair or remote apply; do not reset or destructively change the remote database.
- [ ] Verify Supabase Auth redirect URLs and complete workspace-isolation tests with dedicated staging identities.
- [x] Inspect `SECURITY DEFINER` scheduler functions: execution ACLs are restricted to `service_role` and `postgres`, with an empty function `search_path`; no public/anon/authenticated execution grants were observed.
- [x] Recheck the live staging catalog after replay: all 8 public tables have RLS enabled, 23 policies span all 8 tables, and `anon` has zero table grants. The expected application constraints and foreign keys are present and validated.
- [x] Review performance-advisor output. The 16 `unused_index` findings are informational on the currently empty staging tables; retain these indexes because they support expected workspace/run/scheduler access patterns, and reassess after representative staging traffic.

These checks target staging only. No production project, production environment variables, or live execution settings were changed during this checkpoint.
 
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
