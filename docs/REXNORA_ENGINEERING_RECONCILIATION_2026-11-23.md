# Rexnora engineering reconciliation — 2026-11-23

**Purpose:** Current evidence reconciliation against the authoritative Rexnora readiness roadmap. This is a status snapshot, not a release approval.
**Repository:** `veerex758/Ai-automation`
**Main snapshot:** `92716c5546117ba337717c0d83c7a1719355c88f`
**Authoritative plan:** [REXNORA_99_READINESS_ROADMAP.md](./REXNORA_99_READINESS_ROADMAP.md)
**Baseline history:** [REXNORA_ENGINEERING_BASELINE_2026-11-15.md](./REXNORA_ENGINEERING_BASELINE_2026-11-15.md)

## Executive status

Rexnora's product-core, Stage 3 connection work, and real-estate pilot implementation have substantial automated verification. They are **not yet accepted for customer use** because the connected Preview is not isolated from the current shared Supabase project and its server/provider credentials are empty. Authenticated staging and agency acceptance have not been demonstrated.

Do not interpret a green CI run or a READY Vercel deployment as proof of a working authenticated customer journey.

## Exact repository and PR state

| Item | Current head / base | Automated evidence | Remaining acceptance |
|---|---|---|---|
| Main | `92716c5546117ba337717c0d83c7a1719355c88f` | Current release source of truth | Product-core and pilot changes below are not merged to main. |
| #207 product core | `2180135a961661be8c06ece51b4462b22f125237` → `main` | CI, clean migration replay and MySQL/MongoDB service integration passed; Vercel status READY | Authenticated graph save/reload, Gemini graph generation, dry-run/activation, cancellation and signed-webhook staging acceptance. Supabase Preview was skipped. |
| #224 Stage 3 node connections | `9ea6bc7b925c456fd01049d8538647481d43ba8c` → `main` (draft) | CI, clean migration replay and MySQL/MongoDB service integration passed; Vercel status READY | Authenticated multiple-account save/test/rotate/disconnect, node connection persistence, Google OAuth and cross-workspace isolation. |
| #225 real-estate pipeline | `4fda387c58aaf20a7c9d0d8d7d3210d45761b973` → `main` (draft) | CI, clean migration replay and MySQL/MongoDB service integration passed; Vercel status READY | Credential-backed lead intake → Gemini → approved Resend notification → persisted result, controlled retry/recovery and agency acceptance. |
| #226 secure connection storage | `47d41cf8d6691914283235632f89f76e94eb3509` → `preview/combined-stage3-real-estate-2026-11-22` (draft) | On this exact head: CI workflow tests, lint, type-check and production build passed; clean Supabase migration replay and pgTAP passed; MySQL/MongoDB service integration passed. Vercel deployment `dpl_CriUcW2UQuM9Eg2moWX2Yz6ooN5a` was READY. | Finish the exact-head production build check; authenticated staging acceptance remains outstanding. |

PR #226's scope remains narrow: server-only `save_workspace_integration_connection`, AES-256-GCM envelope storage, multiple same-provider accounts, targeted updates, owner/admin enforcement, secret-table restrictions and safe database error codes. Its SQL fixtures were corrected to use versioned encrypted-envelope-shaped values and the new sanitized SQLSTATE/message contract. Its API now recognizes the server-only `CODED_SUPABASE_SECRET_KEY` variable name as a fallback; this does not create or provision a missing secret.

**No implementation PR was merged to main as part of this reconciliation.** PR #226 is stacked on the combined Preview branch, not directly on main. Do not merge the combined stack out of order or bypass the Stage 1/2 acceptance gates.

## Preview and database boundary

- The combined Preview source branch is `preview/combined-stage3-real-estate-2026-11-22` at `5688541edf7e6da8d076180c6e0283d292bea28c`. The latest PR #226 deployment at this snapshot is READY, but READY only establishes successful deployment/build.
- Vercel project deployment protection is enabled for all deployments except custom domains. Authenticated Preview/browser acceptance was not performed by this snapshot.
- The Preview `NEXT_PUBLIC_SUPABASE_URL` resolves to project `uthqrszdtzmicspryxbw`, the same connected Supabase project used by the current Production target. It is not an isolated Preview database.
- Supabase branch inventory exposes only the `main` branch; no isolated Rexnora staging branch is available. The branch metadata reported `MIGRATIONS_FAILED` while the project-level status reported `ACTIVE_HEALTHY`; this mismatch needs reconciliation before relying on that database for acceptance.
- Read-only database inspection found that `save_workspace_integration_connection` is not yet present in the connected project and the legacy `(workspace_id, provider)` unique constraint is still present. The PR #226 migration has **not** been applied to that shared database.
- Preview server credentials are empty: the Preview `SUPABASE_SERVICE_ROLE_KEY`, `CODED_SUPABASE_SERVICE_ROLE_KEY` and `CODED_SUPABASE_SECRET_KEY` entries did not have values. Preview `GEMINI_API_KEY`, `RESEND_API_KEY` and `AIVANTA_CREDENTIALS_ENCRYPTION_KEY` entries were also empty when checked.
- `REAL_ESTATE_PIPELINE_ENABLED` and `REAL_ESTATE_FOLLOWUPS_ENABLED` are not configured for Preview. The existing `AIVANTA_LIVE_EXECUTION_ENABLED` entry spans Production and Preview and must not be treated as a Preview test approval.
- No credential, integration, lead, email or migration write was made against the shared database.

**Safety decision:** Do not run authenticated save/delete tests, create lead fixtures, send Resend messages or apply migrations against this shared project. Create/use an isolated Supabase staging database first, with explicit cost approval if a new Supabase branch/project is required. Keep secret values inside Vercel's environment settings; do not paste them into chat or source control.

## Integration and real-estate test interpretation

Automated coverage validates the connection lifecycle contract, multi-account storage, rotation invalidation, metadata-only responses, secret access restrictions, cross-workspace rejection and secret cascade behavior. These are disposable local database test results, not proof that a signed-in agency can use the live Preview.

The real-estate implementation includes:
- Public intake keys stored as hashes, origin allowlists, input/consent validation, rate limiting and idempotency.
- Deterministic lead scoring and a Gemini qualification operation that excludes direct contact identifiers.
- Workspace-connection and operation-approval gates for Gemini and Resend.
- Persisted qualification, lead activity and notification/follow-up state.
- Workspace-scoped leases, expired-lease recovery and idempotency for notification operations.
- Authenticated scheduler routes and explicit feature flags.

The code-level and disposable-database tests pass on the cited PR heads. No authenticated intake or provider call was executed against an isolated staging workspace, no message was sent, and no agency sign-off is recorded.

## Security observations

**Positive evidence**
- `workspace_integration_secrets` has RLS enabled, no browser policies and no table privileges for `anon` or `authenticated`.
- Eleven backend-only execution, webhook, approval and secret tables were reported by the security advisor as RLS-enabled without policies. Read-only privilege checks showed no `anon` or `authenticated` table privileges on those tables.
- The inspected SECURITY DEFINER usage/entitlement/follow-up functions check `auth.uid()` and workspace membership; the follow-up stop function also scopes the lead to the supplied workspace and limits stop reasons.
- PR #226's connection RPC uses SECURITY INVOKER with an empty search path, schema-qualified relations and service-role-only execute grants.

**Outstanding review**
- Supabase's security advisor flags three authenticated-executable SECURITY DEFINER functions for further reviewer sign-off. The inspected membership guards are positive evidence, but do not replace staging isolation tests and a complete function review.
- Supabase leaked-password protection is disabled and should be enabled before general customer onboarding.
- No authenticated cross-workspace application test, credential rotation test against the connected database, external-provider failure test or production-like recovery drill is recorded.

## Roadmap reconciliation and next gates

Keep [REXNORA_99_READINESS_ROADMAP.md](./REXNORA_99_READINESS_ROADMAP.md) authoritative; this snapshot does not change its stage order or exit criteria.

1. **Stage 1 — graph generation (#207):** automated checks passed; complete authenticated Gemini graph generation, edit/save/reload, branch correctness and invalid-output acceptance.
2. **Stage 2 — execution reliability (#207):** automated worker/webhook/cancellation coverage passed; complete authenticated manual and signed-webhook execution, induced failure/retry, cancellation, lease-loss and recovery acceptance.
3. **Stage 3 — integrations (#224 + #226):** complete exact-head automated checks, then test save, second same-provider account, provider test, targeted rotation/reconnect, disconnect, RLS and cross-workspace denial against isolated authenticated staging.
4. **Stage 4 — real-estate pilot (#225):** use approved test data and explicit operation approvals to verify intake, Gemini qualification, approved Resend notification, persisted outcome, duplicate recovery, follow-up stop conditions and agency-visible result. Obtain agency sign-off.
5. **Stages 5–9:** continue in the authoritative roadmap order after core and pilot gates. Do not let marketplace or recurring billing work displace the pilot.

No new readiness percentage is asserted here. Planned work, open PRs, disposable CI tests and READY deployments do not count as authenticated staging or customer acceptance. The roadmap's 99% definition remains unchanged.
