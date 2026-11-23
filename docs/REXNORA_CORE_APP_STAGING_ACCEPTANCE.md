# Rexnora Core App — isolated Preview and authenticated staging acceptance

**Updated:** 2026-11-23  
**Candidate:** PR #230 — `feat/core-app-completion-20261123`  
**Exact code/test head:** `4f3f61686884febb72f94eb96194ea47ab20f563`  
**Authoritative plan:** `docs/REXNORA_99_READINESS_ROADMAP.md`  
**Staging baseline:** `docs/REXNORA_STAGE3_STAGING_ACCEPTANCE.md`

## Decision boundary

PR #230 remains an open draft stacked on the Stage 3 integration branch. This record does not authorize merge, production promotion, customer traffic, live email, live payments, production data access or production configuration changes.

The isolated staging Supabase project is `ygclofqxtztnynkljipj` (`aivanta-staging`, eu-west-1). It is ACTIVE_HEALTHY and separate from Production.

## Exact-head automated evidence

| Gate | Exact commit | Result | Evidence |
|---|---|---|---|
| CI: workflow tests, lint, type-check and Next.js production build | `4f3f61686884febb72f94eb96194ea47ab20f563` | **Passed** | [GitHub Actions run #3613](https://github.com/veerex758/Ai-automation/actions/runs/45251311925) |
| Real MySQL/MongoDB TLS driver integration | `4f3f61686884febb72f94eb96194ea47ab20f563` | **Passed** | [GitHub Actions run #1189](https://github.com/veerex758/Ai-automation/actions/runs/45251312086) |
| Vercel Preview build | `4f3f61686884febb72f94eb96194ea47ab20f563` | **READY** | Deployment `dpl_6DeyVdxvzkMxqYRvA4VdTLsSapXD` |

The Preview URL is:

`https://ai-automation-8tm4gg6sh-veerex-org.vercel.app`

The deployment was built from the exact PR #230 head. It was created before the final three branch-only scheduler/webhook secret records were added, so it must be redeployed after the Vercel deployment API limit is cleared. A READY build does not itself prove that the runtime has all required secrets or that authenticated application journeys pass.

## Feature-branch Preview configuration

The following records were created with target `preview` and Git branch `feat/core-app-completion-20261123` only:

- Supabase public URL and publishable/legacy anon keys for the isolated staging project, including the `CODED_*` compatibility names.
- `AIVANTA_LIVE_EXECUTION_ENABLED=false`
- `REAL_ESTATE_PIPELINE_ENABLED=false`
- `REAL_ESTATE_FOLLOWUPS_ENABLED=false`
- `AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED=false`
- Dedicated branch-only `CRON_SECRET`
- Dedicated branch-only `AIVANTA_WEBHOOK_ENCRYPTION_KEY`
- Branch-only `AIVANTA_WEBHOOK_SECRET_KEY_VERSION=v1`

The scheduler and webhook keys were generated specifically for this Preview branch. The staging database was checked before generating the webhook key: `public.webhook_endpoints` contained zero rows, so no existing webhook records rely on the Stage 3 webhook key.

No Production environment variable was edited.

## Secrets that must match the Stage 3 staging environment

Two existing Stage 3 values must be copied exactly into Preview for `feat/core-app-completion-20261123`:

1. `CODED_SUPABASE_SERVICE_ROLE_KEY` (or `CODED_SUPABASE_SECRET_KEY`, whichever is the populated Stage 3 key selected by the shared admin client).
2. `AIVANTA_CREDENTIALS_ENCRYPTION_KEY`.

Do not generate replacements for these values.

The staging database contains one row in `public.workspace_integration_secrets`. That row is encrypted with the existing workspace credential key. Replacing the key would make the stored credential unreadable and break credential verification/worker execution. The service-role key must also match the staging Supabase project; a generic Preview/Production key is not a safe substitute.

Vercel exposes the sensitive values as redacted through the connected read-only environment tooling. They were not retrieved, copied or guessed. The Stage 3 branch has dedicated Preview-only records for these values; the feature branch currently does not. Generic Preview records also exist, but they are not accepted as evidence that the correct Stage 3 secrets are selected.

**Required owner action:** In Vercel Project Settings → Environment Variables, duplicate the exact values from the Stage 3 branch-only Preview records above to branch `feat/core-app-completion-20261123`, keeping them sensitive and Preview-only. Do not copy Production values. Do not post the values in chat, a GitHub issue, source code or this document.

## Staging data boundary observed

A count-only query against the isolated staging database returned:

| Relation | Rows |
|---|---:|
| `auth.users` | 2 |
| `public.workspaces` | 2 |
| `public.workspace_members` | 2 |
| `public.workspace_integration_secrets` | 1 |
| `public.webhook_endpoints` | 0 |

No email addresses, authentication material, credential ciphertext or user records were read into this acceptance record.

## Authenticated staging acceptance

**Status: BLOCKED — not yet executed.**

The staging database has two users, two workspaces and two workspace memberships, but no verified credentials for those users were available through the connected tools. No actual owner/admin browser login was performed. Existing Stage 3 database-level JWT/RLS transaction tests are useful evidence but are not authenticated browser acceptance.

The following acceptance steps remain required after the missing secrets have been duplicated and a fresh Preview is built from the exact head:

1. Use the Vercel-protected Preview with an authorized staging owner account; verify login, session refresh/expiry, dashboard loading, workspace selection and logout.
2. Verify owner/admin can manage workspace settings and connections, while member/viewer roles are denied management actions.
3. Verify an authorized user can only read and mutate records in their own workspace.
4. Save and verify a staging Gemini/Resend connection using the explicitly selected connection ID. Rotate one connection and confirm the other connection is unaffected.
5. Confirm secret values and ciphertext do not appear in browser responses, page state, workflow definitions or logs.
6. Confirm workflow activation rejects missing, disconnected, untested, revoked and cross-workspace connections.
7. Exercise dry-run and the approved test execution path with live execution disabled; confirm no external provider side effects occur.
8. Verify unauthenticated webhook and scheduler rejection, and signed webhook replay protection without enabling live customer jobs.
9. Record sanitized evidence: UTC time, Preview deployment ID/commit, role used, test case and pass/fail result. Never record credentials, tokens, headers, email addresses or provider payloads.

The staging smoke workflow is defined in `.github/workflows/aivanta-staging-smoke.yml` and requires the protected GitHub `staging` environment variables/secrets. The Vercel protection bypass secret and authorized staging test-account credentials were not available through the connected tools. Do not disable deployment protection to make the smoke checks pass.

## Current blockers and exit decision

- **Automated code gates:** passed on the exact PR #230 head.
- **Preview build:** READY on the exact PR #230 head.
- **Non-secret Preview configuration:** branch-scoped and created; all live execution gates remain false.
- **Fresh build after final secret-record creation:** required. A subsequent manual deployment attempt was rejected by Vercel's free-plan daily deployment API limit (`api-deployments-free-per-day`, retry-after 24 hours).
- **Matching Stage 3 service-role and workspace-credential encryption secrets:** owner must duplicate them securely to the feature branch Preview scope.
- **Authenticated owner/admin browser acceptance:** blocked until the secrets are in place, a fresh deployment is built, the protected Preview can be accessed through the approved staging route, and an authorized staging account can sign in.
- **Provider sandbox and agency/customer acceptance:** not run; remain later roadmap gates.

No production migration, production environment edit, production deployment, live email, live payment or customer workflow was performed.

**Exit decision: NOT PASSED.** Do not merge PR #230 or claim authenticated staging acceptance until every blocked item above has recorded evidence.
