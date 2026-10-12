# Aivanta Supabase staging rebuild notes

## Scope and safety boundary

- Supabase staging project: `ygclofqxtztnynkljipj`
- Application branch: `staging/aivanta-supabase-rebuild`
- Vercel Preview variables are scoped to Preview; Production-scoped variables were not changed.
- Do not point staging at production data or run a production migration as part of this rebuild.

## Verified staging state

- The eight core application tables exist and have RLS enabled.
- The database security advisor returned no findings in the latest check.
- Anonymous table privileges are revoked; authenticated table privileges are explicitly granted by the least-privilege grants migration.
- Workspace membership policies and ownership/admin restrictions are present.
- Scheduler security-definer RPCs are not executable by `anon` or `authenticated`; they remain service-role-only.
- The latest deployment for this branch is READY and `/api/health` returns HTTP 200.
- The scheduler endpoint intentionally remains disabled until staging gates pass. It currently fails closed with HTTP 503 because scheduler authentication is not configured in Preview.

## Migration history reconciliation — do not skip

The repository currently contains 24 SQL migration files, while the staging database ledger contains 19 migration records after the focused forward-fix below. The ledger uses replay/baseline names and timestamps that do not match the repository filenames one-for-one. The ledger uses replay/baseline names and timestamps that do not match the repository filenames one-for-one. The live schema and policies show that key features are present, but this alone does not prove that every local migration is represented identically in the ledger.

**Until a migration diff or an explicit, reviewed baseline mapping is completed, do not run `supabase db push` against this staging project.** A naïve push may attempt to replay old source migrations because their version IDs are absent from the remote ledger. Do not manually insert ledger rows merely to make counts match, and do not rerun migrations with destructive DDL.

Safe next steps:

1. Generate a schema diff between the checked-out migration source and the isolated staging database.
2. Map each local migration to an already-applied baseline/parity change or identify the genuinely missing SQL.
3. If history repair is needed, use the Supabase CLI migration-repair workflow against staging only, with the exact reviewed version list.
4. Re-run schema, RLS, grants, and advisor checks after reconciliation.
5. Run authenticated cross-workspace tests before enabling scheduler credentials or considering production cutover.

## Outstanding end-to-end gates

- Exercise authenticated reads/writes with dedicated staging test users.
- Prove a user from workspace A cannot read or mutate workspace B data.
- Verify workflow save/version persistence and run-history writes through the application.
- Test the authenticated scheduler path only after the other staging gates pass.


## Follow-up verification — 2026-10-13

- Rechecked the newest Preview deployment for commit `47d79a54dd5f93ee76151b42be57af06c5a4ce92`: deployment state is `READY`; `/api/health` returned HTTP 200 with `{"status":"ok","service":"aivanta"}`.
- Rechecked core-table RLS: 8 of 8 expected tables have RLS enabled.
- Rechecked table grants: `anon` has no SELECT or INSERT privileges on any of the eight core tables. Authenticated grants match the intended least-privilege pattern (no UPDATE/DELETE on immutable workflow versions or audit events; no DELETE on runs, run steps, schedules, or workspaces).
- Rechecked function execution: scheduler claim/renew/finish/record RPCs remain unavailable to both `anon` and `authenticated`; workspace helper functions are not executable by `anon`. Security advisor returned no findings.
- The source migration `20261013000000_aivanta_staging_authenticated_least_privilege_grants.sql` exists in the branch, but its exact timestamp/version is not present in the remote migration ledger. The resulting grants are present in the live catalog. This is additional evidence that the ledger is not a one-to-one record of the source files; it is **not** permission to fabricate a ledger entry. Keep reconciliation open until a reviewed diff/baseline map is available.
- Authenticated cross-workspace and application write-path tests remain unverified. Keep scheduler disabled and do not change Production environment variables.


## Forward schema-parity fix — 2026-10-13

- Catalog inspection found a real mismatch: `public.workflow_runs.completed_at` was still `NOT NULL`, even though the canonical source migration explicitly allows NULL while a live run is in progress.
- Added repository migration `20261013001000_aivanta_workflow_run_completion_timestamp_parity.sql` (commit `cbc23b889e6851afdefd7cf2fbfbe2d05302f4e6`) and applied the equivalent idempotent DDL to the isolated staging project under migration name `aivanta_workflow_run_completion_timestamp_parity`.
- Verified afterward: `workflow_runs.completed_at` is nullable; its completion-order constraint correctly allows NULL or a timestamp at/after `started_at`; `workflow_run_steps.completed_at` remains non-null as intended.
- The remote migration ledger now has 19 records. The source/ledger mapping is still not a one-to-one match, so keep the broad history reconciliation gate open and do not use blind `db push`.
- Security advisor was rerun after the DDL and returned no findings.
