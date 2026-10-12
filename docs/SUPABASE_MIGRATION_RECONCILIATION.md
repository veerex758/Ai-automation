# Supabase staging migration reconciliation

Checkpoint: 2026-10-13  
Project: `aivanta-staging` (`ygclofqxtztnynkljipj`)  
Branch under review: `staging/aivanta-supabase-rebuild`

## Purpose and safety boundary

The remote Supabase migration ledger contains 20 entries. The staging branch currently tracks 25 SQL files under `supabase/migrations/`. The version/name pairs do not match one-for-one. This is evidence of migration-history drift, not by itself evidence of a missing database object.

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
| 20261012230922 | aivanta_staging_authenticated_least_privilege_grants | Candidate semantic counterpart: `20261013000000_aivanta_staging_authenticated_least_privilege_grants.sql`. |\n| 20261012232845 | aivanta_workflow_run_completion_timestamp_parity | Matched to live nullable `completed_at` and NULL-safe `workflow_runs_completion_order`; tracked counterpart is `20261012232845_aivanta_workflow_run_completion_timestamp_parity.sql`. |\n| 20261012233319 | aivanta_run_step_insert_policy_parity | Forward-fix applied to staging after catalog comparison found the live INSERT policy had regressed to dry-run-only. Tracked counterpart: `20261013002000_aivanta_run_step_insert_policy_parity.sql`. Replay verification still required. |
| 20261012233319 | aivanta_run_step_insert_policy_parity | Matched to tracked migration `20261013002000_aivanta_run_step_insert_policy_parity.sql`; live INSERT policy was verified against the tracked lifecycle conditions. |

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
18. `20261012232845_aivanta_workflow_run_completion_timestamp_parity.sql`
19. `20261012233000_aivanta_default_workspace_trigger_parity.sql`
20. `20261012234000_aivanta_save_workflow_definition_parity.sql`
21. `20261012235000_aivanta_updated_at_trigger_parity.sql`
22. `20261012235500_aivanta_workspace_helper_parity.sql`
23. `20261012235900_aivanta_workspace_owner_update_policy.sql`
24. `20261013000000_aivanta_staging_authenticated_least_privilege_grants.sql`\n25. `20261013002000_aivanta_run_step_insert_policy_parity.sql`
25. `20261013002000_aivanta_run_step_insert_policy_parity.sql`

## Live catalog evidence captured

- Eight public application tables are present; RLS is enabled on all eight.
- 23 policies are present across the eight tables. A comparison caught a substantive mismatch in `workflow_run_steps`: the live INSERT policy was dry-run-only despite tracked hardening migrations allowing authenticated creators to insert steps for their own running live runs. Applied a forward-only staging migration and re-queried the catalog; the policy now checks workspace membership, parent run/workspace identity, creator identity, and mode/status-specific step states.
- No `anon` table grants were observed in `public`.
- Expected application constraints and foreign keys were present and validated. The live `workflow_runs_completion_order` check explicitly allows `completed_at IS NULL`, matching in-progress run semantics; the missing tracked parity migration has now been added to the staging branch.
- Scheduler `SECURITY DEFINER` functions had empty `search_path` and execution ACLs limited to `service_role` and `postgres`.
- Workspace helper functions exist with empty `search_path`; the membership/owner helpers are executable by `authenticated`, consistent with their use in RLS policies.
- Staging tables currently have zero rows, so this audit does not replace realistic authenticated tenant-isolation tests.
- A clean isolated replay previously passed at commit `665a77df361188a22904c86647294d84c05460ba`; this predates the tracked completion-timestamp parity migration, so replay of the current 25-file inventory still needs confirmation.
- The live `workflow_runs_completion_order` constraint matches `CHECK (completed_at IS NULL OR completed_at >= started_at)`; `completed_at` is nullable. This confirms live schema parity, not clean-replay success.
- The run-step INSERT policy now matches the tracked lifecycle logic: dry-run steps require a finished dry-run parent owned by the caller; live-run steps require a running live parent owned by the caller. This catalog check is not a substitute for authenticated end-to-end tests.
- The redundant second completion-timestamp migration is not present in the current branch tree. The canonical tracked file is `20261012232845_aivanta_workflow_run_completion_timestamp_parity.sql`, matching the remote ledger name. No duplicate ledger entry was created.\n- Rechecked scheduler RPC ACLs after the policy forward-fix: scheduler claim/renew/finish/record functions are not executable by `anon` or `authenticated` and are executable by `service_role`; dry-run and save-definition RPCs are executable by `authenticated` and not by `anon`. Security advisor returned no findings after the policy fix.
- The latest verified Vercel preview deployment for commit `eeff55682d07a0d043c3d4783a87f1513b8c2390` is `READY`; its `/api/health` endpoint returned HTTP 200.

## Remaining work before any remote history repair

- [ ] Replay all 25 tracked migrations in the isolated CI database; confirm the completion-timestamp migration replays cleanly and the final run-history constraint matches live staging.
- [ ] Compare every remaining candidate mapping against the complete tracked SQL and actual object definitions, including the newly recorded run-step policy parity migration.
- [ ] Check table/column defaults, constraints, indexes, triggers, policies, function bodies, and function/table ACLs.
- [ ] Distinguish equivalent consolidated migrations from genuine missing or extra DDL.
- [ ] Have the final mapping reviewed before any ledger repair; prefer no remote write if the live schema is correct and the ledger discrepancy is only historical.
- [ ] Run authenticated staging tests using separate authorized users/workspaces to verify cross-workspace reads and writes are denied.
- [ ] Verify Supabase Auth redirect allow-list and protected-preview smoke tests using approved access. Do not weaken Vercel SSO protection.

No remote database mutation is authorized by this reconciliation document. Production remains untouched.
