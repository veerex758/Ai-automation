# Rexnora — staging credentials and acceptance record

**Updated:** 2026-11-23  
**Applies to:** unified integration candidate PR #229 and the Stage 3 / real-estate / SaaS work stacked on it.

## Current verification boundary

Automated CI is evidence for code and disposable-database behavior only. It is not authenticated staging or customer acceptance. The Preview deployment has previously been observed pointing at the same Supabase project URL as Production. The connected Supabase project is production-mapped and has no isolated preview branch. Therefore no candidate migration may be applied to that database, and Preview must not run live customer workflows against it.

The candidate must remain an unmerged draft until exact-head tests, lint, type-check, production build, clean migration replay, pgTAP, database integration and Vercel Preview are all green. Supabase Preview being skipped because no isolated branch exists is not a pass; record the isolated environment evidence separately.

## Environment prerequisites — do not paste secret values into this document

Create or select a genuinely isolated Supabase staging project (or preview database branch whose isolation from production is verified). Configure the Rexnora Vercel Preview environment to use only that staging project.

Required server-side configuration to supply through Vercel's encrypted environment settings:

- Supabase staging URL and public/anon key for authenticated application traffic.
- Service-role key for server-only RPCs and secret-table operations (SUPABASE_SERVICE_ROLE_KEY, or the configured compatible CODED_SUPABASE_* variable set).
- GEMINI_API_KEY and the approved Gemini model configuration.
- AIVANTA_CREDENTIALS_ENCRYPTION_KEY with valid key material dedicated to the staging environment.
- Real-estate pilot feature/scheduler flags after the exact names and intended Preview-only behavior are confirmed from the deployed code.
- RESEND_API_KEY only where a legacy path explicitly requires it; the Stage 3 customer connection path should use a workspace-saved, encrypted Resend connection, not a deployment-wide fallback.
- Any existing webhook signing secrets and scheduler/worker authorization secrets needed by the routes under test.

Do not enable the shared AIVANTA_LIVE_EXECUTION_ENABLED switch while Preview and Production share a database or execution scope. A Preview-specific live-execution gate must be isolated before any provider side effect is authorized. Use synthetic/test leads and an explicitly approved recipient until the agency signs off.

## Stage 3 connection acceptance

1. Sign in as a staging workspace owner and a separate administrator. Confirm viewer/member roles cannot manage integration credentials.
2. Save two separate accounts for the same provider. Confirm each has a distinct connection ID and updating one does not replace the other.
3. Confirm ciphertext is stored server-side, never returned to the browser, logs, prompts, workflow definitions or test output.
4. Confirm credential verification is recorded on the exact connection. Saving or re-testing resets that connection to needs-attention until verification succeeds.
5. Create a workflow with an explicit connection ID on each provider node. Verify activation rejects missing, untested, disconnected, revoked or cross-workspace selections.
6. Run the workflow in staging and verify the worker decrypts only the selected connection immediately before that provider operation. No default-account fallback is accepted.

## Real-estate pilot acceptance

1. Configure a staging Gemini credential and connect the agency's Resend account through the workspace Integrations UI.
2. Verify the Resend sender domain. Configure one agency-approved notification recipient; the browser must not be able to override the recipient used by the pilot.
3. Submit a synthetic or agency-approved enquiry with consent, source, property interest, budget, location and timeline.
4. Verify intake, lead matching/scoring, Gemini structured qualification, notification, persisted result and visible run trace.
5. Inject a transient provider or delivery failure. Confirm bounded retry/recovery, no duplicate message, and clear operator-visible failure state.
6. Exercise signed webhook verification/replay protection and the 15-minute scheduler in the isolated staging environment.
7. Ask an agency representative to inspect the lead outcome and explicitly accept whether the result saves time or improves response handling. Record date, workspace, workflow version, test case and sign-off evidence without storing personal lead data in this document.

## SaaS and recurring billing acceptance

- Use Stripe and Paystack sandbox credentials, sandbox webhooks and a dedicated staging database to test checkout/authorization, consent, renewal, failure, idempotent retry, reconciliation, cancellation and paid-through entitlement.
- Tax invoice issuance remains blocked on confirmation of the registered seller identity, tax jurisdiction, legal address and applicable rates. Do not represent invoices as legally compliant until those values are reviewed.
- No live-money payment or production billing action is part of this CI task.

## Security and release gates still requiring human/staging evidence

- Confirm Preview and Production point to different Supabase projects and different encryption keys.
- Review the flagged SECURITY DEFINER functions and their grants/authorization boundary; enable leaked-password protection before customer onboarding.
- Verify workspace isolation with two real staging accounts, secret access denial from browser roles, webhook signature/replay defenses, provider allowlists, rate limits and audit logs.
- Verify backup/restore, rollback, incident response and customer-facing privacy/retention/support materials under the Stage 9 roadmap.
- Capture screenshots or logs that prove the mobile dashboard/builder journey works at phone widths.
- Obtain pilot-agency acceptance; automated tests cannot supply this approval.

## Decision rule

A passing exact-SHA CI run and a READY Vercel Preview mean the candidate builds and its automated checks pass. They do not authorize production migration, production deployment, live provider execution, customer onboarding, tax invoice claims or release. Those remain blocked until the isolated credentials and acceptance evidence above exist.
