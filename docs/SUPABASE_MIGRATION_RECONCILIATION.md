# Supabase staging migration reconciliation

Checkpoint: 2026-10-13  
Project: `aivanta-staging` (`ygclofqxtztnynkljipj`)  
Branch under review: `staging/aivanta-supabase-rebuild`

## Purpose and safety boundary

The remote Supabase migration ledger contains 19 entries. The staging branch currently tracks 25 SQL files under `supabase/migrations/`. The version/name pairs do not match one-for-one. This is evidence of migration-history drift, not by itself evidence of a missing database object.

Do not run `supabase migration repair`, reset the remote database, or apply a migration remotely solely to make the ledger resemble the repository. Reconcile by comparing migration contents and the live catalog first. Production is out of scope.

## Remote ledger observed

| Remote version | Remote name | Initial reconciliation note |
| --- | --- | --- |
| 20261012224509 | aivanta_staging_schema_and_workspace_rls | Broad staging baseline; likely represents a consolidated schema/RLS setup, not a direct filename match. |
| 20261012224541 | aivanta_staging_foreign_key_indexes | Compare against foundation indexes and run/scheduler FK indexes. |
| 20261012224946 | aivanta_phase2_dry_run_rpc_and_rls_parity | Candidate semantic counterpart: `20261010194730_aivanta_workflow_dry_run_engine.sql`; verify full function body and grants. |
| 20261012224955 | aivanta_phase2_live_email_schema_guardrails | Candidate semantic counterpart: `20261010201327_aivanta_live_email_runs.sql`; verify columns, checks, policies, and grants. |
| 20261012224957 | aivanta_phase2_run_history_indexes | Compare against run-history and created-by index migrations. |
| 20261012224959 | aivanta_phase2_updated_at_trigger_helper | Compare against foundation trigger/helper definitions and later trigger-parity migration. |
| 20261012225002 | aivanta_phase2_scheduler_foundation | Candidate semantic counterpart: `20261011090000_scheduled_workflow_foundation.sql`. |
| 20261012225005 | aivanta_phase2_scheduler_dry_run_dispatcher | Candidate semantic counterpart: `20261011091000_scheduled_workflow_dispatcher.sql`; verify every RPC body and ACL. |
| 20261012225024 | aivanta_phase2_scheduler_fk_indexes | Compare against scheduler foundation indexes and FK indexes. |
| 20261012225038 | aivanta_phase2_revoke_public_workspace_helper_exec | Compare against security-hardening and workspace-helper parity migrations. |
| 20261012225729 | aivanta_phase2_canonical_schema_parity | Candidate semantic counterpart: `20261012230000_aivanta_staging_schema_parity.sql`; versions/names differ. |
| 20261012225813 | aivanta_phase2_workflow_version_attribution | Candidate semantic counterpart: `20261012231000_aivanta_workflow_version_attribution.sql`. |
| 20261012230426 | aivanta_phase2_default_workspace_trigger_parity | Candidate semantic counterpart: `20261012233000_aivanta_default_workspace_trigger_parity.sql`. |
| 20261012230503 | aivanta_phase2_save_workflow_definition_parity | Compare against original save-definition function and later parity migration. |
| 20261012230528 | aivanta_phase2_updated_at_trigger_parity | Candidate semantic counterpart: `20261012235000_aivanta_updated_at_trigger_parity.sql`. |
| 20261012230613 | aivanta_phase2_workspace_helper_parity | Candidate semantic counterpart: `20261012235500_aivanta_workspace_helper_parity.sql`. |
| 20261012230649 | aivanta_phase2_workspace_owner_update_policy | Candidate semantic counterpart: `20261012235900_aivanta_workspace_owner_update_policy.sql`. |
| 20261012230922 | aivanta_staging_authenticated_least_privilege_grants | Candidate semantic counterpart: `20261013000000_aivanta_staging_authenticated_least_privilege_grants.sql`. |\n| 20261012232845 | aivanta_workflow_run_completion_timestamp_parity | Matched to live nullable `completed_at` and NULL-safe `workflow_runs_completion_order`; tracked counterpart added as `20261012232845_aivanta_workflow_run_completion_timestamp_parity.sql`. Replay verification still required. |

The notes above are candidate mappings only. A candidate is not considered reconciled until its SQL effects are compared with the tracked migration and live catalog.

## Repository migration inventory

The branch currently tracks these 25 SQL migrations, in order:

1. `20261010180000_aivanta_workspace_workflow_foundation.sql`
2. `20261010180100_aivanta_security_performance_hardening.sql`
3. `20261010180200_aivanta_default_workspace.sql`
4. `20261010180300_aivanta_workflow_versioning.sql`
5. `20261010180400_aivanta_workflow_versioning_fixes.sql`
6. `20261010193000_harden_workflow_definition_settings.sql`
7. `20261010194010_aivanta_workflow_run_history.sql`
8. `20261010194730_aivanta_workflow_dry_run_engine.sql`
9. `20261010201327_aivanta_live_email_runs.sql`
10. `20261010201538_index_workflow_runs_created_by.sql`
11. `20261010203527_harden_live_run_step_ownership.sql`
12. `20261010203630_harden_workflow_run_step_inserts.sql`
13. `20261010204255_allow_incomplete_workflow_run_timestamps.sql`
14. `20261011090000_scheduled_workflow_foundation.sql`
15. `20261011091000_scheduled_workflow_dispatcher.sql`
16. `20261012230000_aivanta_staging_schema_parity.sql`
17. `20261012231000_aivanta_workflow_version_attribution.sql`
18. `20261012233000_aivanta_default_workspace_trigger_parity.sql`
19. `20261012234000_aivanta_save_workflow_definition_parity.sql`
20. `20261012235000_aivanta_updated_at_trigger_parity.sql`
21. `20261012235500_aivanta_workspace_helper_parity.sql`
22. `20261012235900_aivanta_workspace_owner_update_policy.sql`
23. `20261013000000_aivanta_staging_authenticated_least_privilege_grants.sql`

## Live catalog evidence captured

- Eight public application tables are present; RLS is enabled on all eight.
- 23 policies were observed across those tables; policy names and expressions should be compared against the tracked SQL, not only counted.
- No `anon` table grants were observed in `public`.
- Expected application constraints and foreign keys were present and validated. The live `workflow_runs_completion_order` check explicitly allows `completed_at IS NULL`, matching in-progress run semantics; the missing tracked parity migration has now been added to the staging branch.
- Scheduler `SECURITY DEFINER` functions had empty `search_path` and execution ACLs limited to `service_role` and `postgres`.
- Workspace helper functions exist with empty `search_path`; the membership/owner helpers are executable by `authenticated`, consistent with their use in RLS policies.
- Staging tables currently have zero rows, so this audit does not replace realistic authenticated tenant-isolation tests.
- A clean isolated replay previously passed at commit `665a77df361188a22904c86647294d84c05460ba`; this predates the newly added completion-timestamp migration, so the new migration still needs its own replay confirmation.\n- The live `workflow_runs_completion_order` constraint was re-queried after adding the tracked parity migration and matches `CHECK (completed_at IS NULL OR completed_at >= started_at)`; `completed_at` is nullable. This confirms live schema parity, not clean-replay success.\n- A second source migration, `20261013001000_aivanta_workflow_run_completion_timestamp_parity.sql`, also drops `NOT NULL` on `completed_at`. It is redundant with the earlier timestamped parity migration and is not a separate remote-ledger entry. Keep it explicitly tracked during review; do not fabricate a ledger record for it. Before any history repair, decide whether to retain this harmless idempotent duplicate or remove it in a reviewed branch change.\n- The latest Vercel preview deployment for commit `170e2339f7e1718c25c7fad6a2bcbdcddcbc3080` is `READY` and its combined Vercel status is `success`.

## Remaining work before any remote history repair

- [ ] Replay all 25 tracked migrations in the isolated CI database; confirm both completion-timestamp migrations replay cleanly and that the final run-history constraint matches live staging.\n- [ ] Review whether the redundant `20261013001000` completion-timestamp migration should be removed from source history; do not alter the remote ledger to accommodate it.\n- [ ] Compare every remaining candidate mapping against the complete tracked SQL and actual object definitions.
- [ ] Check table/column defaults, constraints, indexes, triggers, policies, function bodies, and function/table ACLs.
- [ ] Distinguish equivalent consolidated migrations from genuine missing or extra DDL.
- [ ] Have the final mapping reviewed before any ledger repair; prefer no remote write if the live schema is correct and the ledger discrepancy is only historical.
- [ ] Run authenticated staging tests using separate authorized users/workspaces to verify cross-workspace reads and writes are denied.
- [ ] Verify Supabase Auth redirect allow-list and protected-preview smoke tests using approved access. Do not weaken Vercel SSO protection.

No remote database mutation is authorized by this reconciliation document. Production remains untouched.
