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

The repository currently contains 23 SQL migration files, while the staging database ledger contains 18 migration records. The ledger uses replay/baseline names and timestamps that do not match the repository filenames one-for-one. The live schema and policies show that key features are present, but this alone does not prove that every local migration is represented identically in the ledger.

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
