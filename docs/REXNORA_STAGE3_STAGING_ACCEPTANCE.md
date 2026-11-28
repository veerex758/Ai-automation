# Rexnora — Stage 3 staging credentials and acceptance record

**Updated:** 2026-11-23  
**Candidate:** PR #229 — `integration/saas-core-stage3-realestate-20261123`  
**Validated code/test head:** `623e838f60cb021d6fce4855c57e0ddaa6b5e530` (the update to this acceptance record is documentation-only)

## Verification boundary

This candidate remains an **open draft**. Do not merge, promote, or run customer traffic until all release gates below pass. Production database and Production Vercel variables have not been changed by this Stage 3 work.

The isolated staging Supabase project is `ygclofqxtztnynkljipj` (`aivanta-staging`, eu-west-1). Production is a separate project. Candidate database migrations were applied only to staging; the current manual staging migration ledger contains 262 records. The ledger count is descriptive, not proof of source-history equivalence.

## Automated workflow evidence

| Workflow | Commit | Run | Result |
|---|---|---:|---|
| CI (tests, lint, type-check, build) | `623e838` | 45244251944 | **Passed** — workflow tests, lint, type-check and production build |
| Clean migration replay + pgTAP | `623e838` | 45244251760 | **Passed** — clean replay, pgTAP and migration inventory check |
| Real MySQL/MongoDB TLS worker integration | `623e838` | 45244251679 | **Passed** — authenticated TLS containers and real driver tests |

All three workflows above completed successfully for the validated code/test head. The current PR head after this documentation-only update differs only in this Markdown acceptance record; no application source, test or SQL migration changed after the validated head.

## Staging database security evidence

Latest staging inventory:

- 96/96 public tables have RLS enabled.
- 45 RLS-enabled tables have no direct policies; none grants SELECT, INSERT, UPDATE or DELETE to `anon` or `authenticated`. These are service-role/internal tables.
- 18 `SECURITY DEFINER` functions executable by authenticated users all have an explicit empty search path and user/workspace-scoped authorization in their function bodies. Usage RPCs and workspace RPCs check membership/owner roles; marketplace creator/buyer RPCs constrain reads and mutations to the signed-in user's records.
- Supabase Advisor still reports 18 authenticated-callable `SECURITY DEFINER` functions. This warning remains visible even though the function bodies were reviewed for explicit search paths and caller scoping; keep these RPCs under review and do not remove their intentional application grants without replacing their functionality.
- Browser roles cannot SELECT or INSERT integration secrets and cannot SELECT provider-operation approvals.
- The Supabase security advisor still reports leaked-password protection disabled. Enable it in the Supabase Auth project settings before customer onboarding.

### Cross-workspace isolation

A transaction using two synthetic users and workspaces passed these assertions:

1. Workspace A could not read a lead owned by workspace B.
2. Workspace A could not update workspace B's lead (zero rows updated).
3. Workspace A could not insert a lead into workspace B (permission denied).
4. Workspace B could read and update its own lead.
5. Authenticated browser roles were denied integration-secret SELECT/INSERT and approval-table SELECT.

The fixture transaction was rolled back; no test lead or user fixture was retained. This is database-level JWT-claim/RLS verification, **not** a real browser login acceptance test.

### Connection RPC and entitlement tests

A separate rolled-back staging transaction verified:

- Two Gemini connections can coexist in one workspace with distinct IDs.
- Both secret rows are stored as v2 envelopes.
- Updating one connection resets only that connection's verification state; the other remains connected and verified.
- A save attempt for an unowned/nonexistent connection ID fails closed.
- Usage metering allows 20 credits, treats a duplicate idempotency key as no additional consumption, and rejects a further 6 credits above the free-plan limit of 25.

The tests used synthetic credentials/ciphertext and were rolled back. They do not prove a live Gemini or Resend account can authenticate or send.

## Application integration changes made

- Workspace integration save/update and provider verification use an exact connection ID; there is no implicit account fallback.
- OAuth callback writes the selected connection, using workspace/provider/connection-bound v2 encryption. Existing v1 credentials remain readable.
- Resend verification and test-email routes now accept v1/v2 and use the exact connection ID in v2 associated data.
- The durable worker selects the exact connected, freshly tested connection and supports legacy v1 plus connection-bound v2 refresh.
- Privileged route clients for integrations, OAuth, scheduler, workflow dispatch/execution, approvals and webhook management use the shared branch-aware admin Supabase configuration.
- On the Rexnora integration Preview branch, server-side admin access prefers the branch-scoped staging `CODED_SUPABASE_SERVICE_ROLE_KEY`; the branch is explicitly identified with `VERCEL_GIT_COMMIT_REF`. Other Preview branches and Production retain their prior resolution.
- The test suite was updated to assert the new helper/RPC and whitespace-tolerant SQL contracts. Exact-head CI has not yet completed, so these code paths are not marked release-verified.

## Vercel Preview environment

The Vercel project has 16 environment-variable records scoped to Preview only and this branch only. Names are recorded here; secret values are intentionally omitted.

- Staging URL and public/anon keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CODED_SUPABASE_URL`, `NEXT_PUBLIC_CODED_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CODED_SUPABASE_ANON_KEY`.
- Server credentials: `CODED_SUPABASE_SERVICE_ROLE_KEY`, `CODED_SUPABASE_SECRET_KEY`.
- Credential encryption: `AIVANTA_CREDENTIALS_ENCRYPTION_KEY`.
- Scheduler and webhook isolation: branch-only `CRON_SECRET`, `AIVANTA_WEBHOOK_ENCRYPTION_KEY`, `AIVANTA_WEBHOOK_SECRET_KEY_VERSION`.
- Live gates: `AIVANTA_LIVE_EXECUTION_ENABLED=false`, `REAL_ESTATE_PIPELINE_ENABLED=false`, `REAL_ESTATE_FOLLOWUPS_ENABLED=false`, `AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED=false`.

The branch-specific `NEXT_PUBLIC_SUPABASE_URL` resolves to the staging project hostname `ygclofqxtztnynkljipj.supabase.co`. The existing generic Preview/Production `CRON_SECRET` record was left unchanged; a Preview-only branch override was created. No Production variable was edited.

**Deployment gap:** the newest observed READY Vercel Preview for this branch is commit `1a89740`, not the validated `623e838` head. A fresh deployment request hit Vercel's `api-deployments-free-per-day` limit (HTTP 402; over 100 daily API deployments). GitHub's Vercel status is consequently failing with the build-rate-limit link. The current code and latest branch-scoped variable changes have **not** yet been verified by a newly built exact-head Preview. Do not treat the older READY deployment as current acceptance.

## Authenticated staging acceptance — not complete

No real staging owner/admin browser session has been used. The current tests emulate JWT claims inside database transactions; they do not establish the sign-in flow, cookies, role UI or live API paths from an authenticated browser session.

Still required with actual staging accounts:

1. Sign in as a staging workspace owner and a separate workspace administrator; verify member/viewer roles cannot manage connections.
2. Save two real accounts for one provider, verify independently, rotate one, and confirm the other remains intact.
3. Confirm API responses, browser state, logs and workflow definitions never expose ciphertext or tokens.
4. Author a workflow with explicit connection IDs; confirm activation rejects missing, disconnected, untested, revoked and cross-workspace IDs.
5. Execute against a provider sandbox/test account and confirm the worker decrypts only the selected connection.
6. Run a synthetic real-estate enquiry through Gemini qualification and a workspace-saved Resend account; verify persisted output, notification, trace, retry/recovery and duplicate protection.
7. Test signed webhook replay protection and scheduler execution in Preview with live customer execution disabled.
8. Obtain and record pilot-agency acceptance before real customer use.

Do not paste credentials into this document or chat. Use encrypted Vercel settings and the approved staging test accounts/recipients.

## Release blockers

- The CI, clean migration replay + pgTAP, and MySQL/MongoDB database-service workflows passed for `623e838` (the current PR head after this document-only update has the same application/test/SQL trees).
- A fresh READY Vercel Preview must be built from the exact current SHA after the Vercel deployment limit is cleared.
- Real authenticated owner/admin staging acceptance and provider-sandbox tests remain outstanding.
- Enable leaked-password protection in Supabase Auth settings.
- Agency acceptance, mobile-width acceptance, backup/restore, incident response, customer-facing privacy/retention/support material and the other roadmap gates remain outstanding.

No Production migration, Production deployment, live email, live payment or customer workflow is authorized by this record.
