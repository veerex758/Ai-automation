# Supabase connection and rebuild phases

This checklist applies to the isolated `aivanta-staging` project only. Do not use these steps to alter production.

## Phase 1 — Project and environment connection

- [x] Create the new Supabase project in the selected organization and region.
- [x] Verify the project is healthy and record its project reference.
- [x] Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the Vercel Preview environment only.
- [x] Confirm production environment targets were not changed.

## Phase 2 — Schema, functions, and tenant security

- [x] Create workspace, membership, workflow, version, audit, run-history, run-step, and schedule tables.
- [x] Enable RLS on all eight public tables.
- [x] Add workspace membership helpers and owner/admin policies.
- [x] Add atomic dry-run persistence and scheduler claim/renew/finalize RPCs.
- [x] Add source-tracked schema-parity migration for missing canonical constraints, indexes, and workflow-version creator attribution.
- [x] Restore the missing default-workspace trigger on `auth.users`, the canonical `save_workflow_definition` RPC, and `updated_at` triggers for workspaces/workflows; verify the trigger/RPC definitions and grants in staging.
- [x] Align `private.is_workspace_member` with canonical owner-or-membership semantics and add the restricted `private.is_workspace_owner` helper; verify helper grants and zero security-advisor findings.
- [x] Restrict workspace metadata updates to the workspace owner, matching the canonical owner-only policy; verify the live RLS policy and rerun security advisor.
- [x] Tighten workflow-version inserts so `created_by` must match the authenticated user.\n- [x] Restore the live run-step INSERT policy for authorized creators on their own running live runs, while retaining dry-run state restrictions; verified by rollback-only PostgreSQL tests.\n- [x] Block direct workflow definition/version updates and direct version-history/audit inserts; route writes through validated SECURITY INVOKER RPCs and verify metadata-only edits still work.\n- [x] Verify authenticated save RPC version sequencing (1→2), immutable version snapshots, audit rows, invalid-definition rejection, anonymous RPC denial, and cross-workspace read/save denial. Test fixtures rolled back.
- [x] Restrict scheduler RPC execution to `service_role`.
- [x] Verify live function grants: scheduler RPCs are not executable by `anon` or `authenticated`; dry-run RPC is executable by `authenticated` and not `anon`.
- [x] Run Supabase security advisor after the latest migrations: zero findings.
- [x] Re-run performance advisor: only informational unused-index notices remain on the empty staging database.
- [x] Add indexes for the scheduler foreign keys flagged by the performance advisor.
- [x] Add `supabase/config.toml` for an isolated local Supabase environment and a CI workflow that resets a fresh local database and replays every tracked migration.
- [x] Pass the full clean-replay GitHub Actions workflow for the initial tracked migration set: isolated local database reset, replay, local status check, and cleanup all succeeded.
- [x] Confirm the latest 27-file clean replay, including default-workspace, workflow-save RPC, updated-at trigger, workspace-helper, owner-only policy, run-step parity, and RPC write-guard migrations, is green (Actions run `38323682448`, commit `aa02621d45addfb6a038d38acd05df70d4e23a47`).
- [ ] Reconcile the remote connector-applied migration ledger with the canonical repository sequence. The current remote ledger contains connector-generated migration versions, not the repository's canonical timestamps; do not blindly replay canonical migrations over the populated staging database or manually rewrite migration history before a schema diff and reviewed repair plan.

## Phase 3 — Supabase Auth configuration

- [ ] Configure the staging Site URL and redirect allow-list for the exact Vercel Preview host.
- [ ] Verify email confirmation behavior for staging sign-up.
- [ ] Verify the `/auth/callback` route and session refresh.
- [ ] Confirm no production Auth URLs or providers were changed.

## Phase 4 — Preview deployment

- [x] Configure staging Supabase public variables for Preview only.
- [x] Build a Vercel Preview from `staging/aivanta-supabase-rebuild`.
- [ ] Re-check the deployment after source migration reconciliation.
- [ ] Confirm the deployment can reach the new Supabase project.

## Phase 5 — Safe unauthenticated smoke checks

- [ ] Run `npm run staging:smoke` against the dedicated Preview host.
- [ ] Confirm health returns application JSON, the action catalog and AI endpoint reject unauthenticated calls, and the scheduler rejects unauthenticated requests.
- [ ] Treat Vercel Deployment Protection responses as blocked—not application-level passes.

## Phase 6 — Authenticated acceptance

- [ ] Sign in with an authorized staging test account.
- [ ] Verify workspace creation and membership initialization.
- [ ] Create, update, validate, and dry-run a workflow.
- [ ] Verify run and step history persists.
- [ ] Verify AI drafts require review and are not auto-saved or executed.
- [ ] Verify cross-workspace access is denied.
- [ ] Keep external side effects disabled unless a separate test is explicitly approved.

## Phase 7 — Phase 11 release gates

- [ ] Review request observability and scheduler safety.
- [ ] Review hosting alerts/log retention and assign an owner.
- [ ] Review Auth hardening, backup retention, and a non-production recovery drill.
- [ ] Complete release review before any production rollout.

## Current status

Phase 1 is complete. Phase 2 database objects and security are applied and advisor-checked. Additive schema parity, workflow-version attribution, default-workspace creation, workflow-save RPC, updated-at triggers, and canonical workspace-helper semantics and the owner-only workspace update policy are source-tracked on the staging branch. The isolated clean-replay CI completed successfully for all 27 tracked migrations: fresh local database reset, all migrations replayed, local status check passed, and cleanup succeeded (Actions run `38323682448`). Live staging acceptance now confirms the direct-write guards, validated version 1→2 save sequence, audit/history integrity, anonymous RPC denial, and cross-workspace read/save denial; all fixtures were rolled back. The live staging migration ledger still differs from the repository's canonical migration timestamps, so a reviewed schema comparison and history-reconciliation plan remain required. Phases 3–7 remain in progress. A READY deployment is not proof that authenticated staging acceptance has passed.
