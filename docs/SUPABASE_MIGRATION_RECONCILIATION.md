# Supabase staging migration reconciliation

Checkpoint: 2026-10-13  
Project: `aivanta-staging` (`ygclofqxtztnynkljipj`)  
Branch under review: `staging/aivanta-supabase-rebuild`

## Purpose and safety boundary

The remote Supabase migration ledger contains 24 entries. The staging branch currently tracks 29 SQL files under `supabase/migrations/`. The version/name pairs do not match one-for-one. This is evidence of migration-history drift, not by itself evidence of a missing database object.

Do not run `supabase migration repair`, reset the remote database, or apply a migration remotely solely to make the ledger resemble the repository. Reconcile by comparing migration contents and the live catalog first. Production is out of scope.

## Remote ledger observed

| Remote version | Remote name | Initial reconciliation note |
| --- | --- | --- |
| 20261012224509 | aivanta_staging_schema_and_workspace_rls | Grouped candidate: `20261010180000` foundation, `20261010180100` hardening, `20261010180200` default workspace, `20261010180300`/`20261010180400` versioning, `20261010193000` definition validation, and `20261010194010` run-history foundation. Catalog objects are present; exact DDL grouping still requires line-by-line review. |
| 20261012224541 | aivanta_staging_foreign_key_indexes | Grouped candidate: FK/lookup indexes from `20261010180000`, `20261010194010`, `20261010201538`, and `20261011090000`. The explicit-index inventory was compared against the live catalog: all 18 tracked explicit index names now exist, including three extra remote indexes captured by `20261013005000` and the restored workflow-version history index in `20261013006000`. Exact grouping of those indexes into the original remote baseline remains a history question. |
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
| 20261012230922 | aivanta_staging_authenticated_least_privilege_grants | Candidate semantic counterpart: `20261013000000_aivanta_staging_authenticated_least_privilege_grants.sql`. |
| 20261012232845 | aivanta_workflow_run_completion_timestamp_parity | Matched to live nullable `completed_at` and NULL-safe `workflow_runs_completion_order`; tracked counterpart is `20261012232845_aivanta_workflow_run_completion_timestamp_parity.sql`. |
| 20261012233319 | aivanta_run_step_insert_policy_parity | Forward-fix applied to staging after catalog comparison found the live INSERT policy had regressed to dry-run-only. Matched to tracked migration `20261013002000_aivanta_run_step_insert_policy_parity.sql`; live INSERT policy was re-queried and verified against the tracked lifecycle conditions. The prior 25-file replay passed in run `38322852271`; the current 27-file replay including write-path hardening passed its migration-reset and status steps in run `38323682448` on commit `aa02621d45addfb6a038d38acd05df70d4e23a47`. |

| 20261012234256 | aivanta_rpc_write_path_hardening | First-stage forward hardening restricted direct version/audit inserts and definition updates; followed by the invoker-safe guard migration below. Source: `20261013003000_aivanta_rpc_write_path_hardening.sql`. |
| 20261012234426 | aivanta_invoker_rpc_write_guards | Final staging write path uses SECURITY INVOKER public RPCs, private legacy implementations, transaction-local guard triggers, and explicit workspace checks. Source: `20261013004000_aivanta_invoker_rpc_write_guards.sql`. Security advisor returned zero findings after this correction. The 27-file replay passed in run `38323682448`; the 28-file replay run `38324218149` was superseded by the additional missing-index fix; the final 29-file replay passed in run `38324304643`. |
| 20261012235026 | aivanta_staging_fk_index_parity | Tracks three indexes already present in remote staging but absent from earlier source migrations: `workflow_schedules_created_by_idx`, `workflow_schedules_workspace_id_idx`, and `workspace_members_user_idx`. Source: `20261013005000_aivanta_staging_fk_index_parity.sql`. |
| 20261012235126 | aivanta_workflow_version_history_index_parity | Restores `workflow_versions_workflow_created_idx`, found in the tracked foundation migration but missing from the live catalog. Added as `20261013006000_aivanta_workflow_version_history_index_parity.sql` and confirmed present after apply. The current 29-file replay passed in run `38324304643` on commit `8b4b4248b2f937e510e8c6cbab0a96592fe42c77`. |

The notes above are candidate mappings only. A candidate is not considered reconciled until its SQL effects are compared with the tracked migration and live catalog.

## Repository migration inventory

The branch currently tracks these 29 SQL migrations, in order:

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
24. `20261013000000_aivanta_staging_authenticated_least_privilege_grants.sql`
25. `20261013002000_aivanta_run_step_insert_policy_parity.sql`
26. `20261013003000_aivanta_rpc_write_path_hardening.sql`
27. `20261013004000_aivanta_invoker_rpc_write_guards.sql`
28. `20261013005000_aivanta_staging_fk_index_parity.sql`
29. `20261013006000_aivanta_workflow_version_history_index_parity.sql`

## Source-to-ledger coverage map (semantic grouping, not repair approval)

The source migrations are now grouped against the 24 live ledger entries by the objects and behaviors they establish. This records a reviewable coverage hypothesis; because the remote ledger stores version/name metadata rather than the original SQL bodies, it does not prove which exact DDL was in each remote migration.

- **Remote baseline `20261012224509`** groups the initial workspace/workflow foundation (`20261010180000`), initial security/index hardening (`20261010180100`), default workspace trigger (`20261010180200`), versioning and versioning fixes (`20261010180300`, `20261010180400`), definition validation (`20261010193000`), and run-history foundation (`20261010194010`). The corresponding tables, base constraints, workspace helpers, and RLS objects exist in the live catalog.
- **Remote FK indexes `20261012224541`** groups FK/lookup indexes from the foundation, run-history, created-by, and scheduler migrations (`20261010180000`, `20261010194010`, `20261010201538`, `20261011090000`). The final source parity migration `20261013005000` now tracks the three additional indexes present in the live catalog (`workflow_schedules_created_by_idx`, `workflow_schedules_workspace_id_idx`, `workspace_members_user_idx`). The full explicit-index comparison found three remote indexes absent from source plus one source index absent from staging. Three missing source indexes were added in `20261013005000`; the missing workflow-version history index was added in `20261013006000` and confirmed in the live catalog. All 19 expected explicit index names now exist live; clean replay of the 29-file chain is pending.
- **Remote dry-run RPC `20261012224946`** maps to `20261010194730_aivanta_workflow_dry_run_engine.sql`; its validated RPC and write path were exercised in rollback-only tests.
- **Remote live-email schema `20261012224955`** maps to `20261010201327_aivanta_live_email_runs.sql`; live mode/idempotency columns and lifecycle constraints exist, while actual delivery remains a separate approval gate.
- **Remote run-history indexes `20261012224957`** groups `20261010194010` and `20261010201538`.
- **Remote updated-at helper `20261012224959`** maps to `public.set_updated_at()` and the workflow/workspace/schedule update triggers.
- **Remote scheduler foundation `20261012225002`** maps to `20261011090000_scheduled_workflow_foundation.sql`; **dispatcher `20261012225005`** maps to `20261011091000_scheduled_workflow_dispatcher.sql`; **scheduler FK indexes `20261012225024`** groups its schedule/workspace/run FK indexes. Claim/record/finalize and stale-lease behavior passed rollback-only tests; scheduler RPCs remain service-role-only.
- **Remote revoke-helper execution `20261012225038`** groups initial security hardening (`20261010180100`) and workspace-helper ACL parity (`20261012235500`).
- **Remote canonical schema parity `20261012225729`** maps to `20261012230000_aivanta_staging_schema_parity.sql`.
- **Remote version attribution `20261012225813`** maps to `20261012231000_aivanta_workflow_version_attribution.sql`.
- **Remote default-workspace trigger parity `20261012230426`** groups `20261010180200` and `20261012233000_aivanta_default_workspace_trigger_parity.sql`.
- **Remote save-definition parity `20261012230503`** groups `20261010193000` and `20261012234000_aivanta_save_workflow_definition_parity.sql`; current public RPC delegates to private validated implementation with invoker permissions and write guards.
- **Remote updated-at parity `20261012230528`** maps to `20261012235000_aivanta_updated_at_trigger_parity.sql`.
- **Remote workspace-helper parity `20261012230613`** maps to `20261012235500_aivanta_workspace_helper_parity.sql`.
- **Remote workspace-owner policy `20261012230649`** maps to `20261012235900_aivanta_workspace_owner_update_policy.sql`.
- **Remote least-privilege grants `20261012230922`** maps to `20261013000000_aivanta_staging_authenticated_least_privilege_grants.sql`.
- **Remote completion timestamp `20261012232845`** groups `20261010204255_allow_incomplete_workflow_run_timestamps.sql` and `20261012232845_aivanta_workflow_run_completion_timestamp_parity.sql`.
- **Remote run-step policy `20261012233319`** groups the duplicate historical hardening files `20261010203527_harden_live_run_step_ownership.sql` and `20261010203630_harden_workflow_run_step_inserts.sql`, with final parity in `20261013002000_aivanta_run_step_insert_policy_parity.sql`.
- **Remote write-path hardening `20261012234256`** maps to `20261013003000_aivanta_rpc_write_path_hardening.sql`; **remote invoker guards `20261012234426`** maps to `20261013004000_aivanta_invoker_rpc_write_guards.sql`.
- **Remote FK-index parity `20261012235026`** maps to `20261013005000_aivanta_staging_fk_index_parity.sql` for `workflow_schedules_created_by_idx`, `workflow_schedules_workspace_id_idx`, and `workspace_members_user_idx`.
- **Remote workflow-version history index parity `20261012235126`** maps to `20261013006000_aivanta_workflow_version_history_index_parity.sql` for `workflow_versions_workflow_created_idx`.

**Repair rule:** do not mark source versions applied until the mapping is reviewed against the complete source SQL and the live catalog. Do not use blind `db push`, manual ledger inserts, or remote reset. The available Supabase connector does not expose the CLI migration-repair action; the final ledger repair therefore still requires an approved staging-only CLI session.

## Live catalog evidence captured

- Eight public application tables are present; RLS is enabled on all eight.
- 23 policies are present across the eight tables. A comparison caught a substantive mismatch in `workflow_run_steps`: the live INSERT policy was dry-run-only despite tracked hardening migrations allowing authenticated creators to insert steps for their own running live runs. Applied a forward-only staging migration and re-queried the catalog; the policy now checks workspace membership, parent run/workspace identity, creator identity, and mode/status-specific step states.
- No `anon` table grants were observed in `public`.
- Expected application constraints and foreign keys were present and validated. The live `workflow_runs_completion_order` check explicitly allows `completed_at IS NULL`, matching in-progress run semantics; the missing tracked parity migration has now been added to the staging branch.
- Scheduler `SECURITY DEFINER` functions had empty `search_path` and execution ACLs limited to `service_role` and `postgres`.
- Workspace helper functions exist with empty `search_path`; the membership/owner helpers are executable by `authenticated`, consistent with their use in RLS policies.
- Staging tables are normally empty. Ran a rollback-only SQL acceptance test using two temporary Auth users and separate workspaces: workspace B could not read workspace A's workflow or run step, could not insert into workspace A, and workspace A's owner could insert an authorized step into its own running live run. The transaction was rolled back, and a follow-up query confirmed zero leftover test users, workflows, runs, or steps. A separate rollback-only authenticated RPC test also passed: `save_workflow_definition` persisted version 2, created its immutable version row, and emitted the expected `workflow.definition_saved` audit event. A rollback-only scheduler test passed through claim, dry-run run/step persistence, recovery when the response was treated as lost, and stale-lease rejection. Follow-up queries confirmed zero leftover test users, workflows, versions, audit events, schedules, runs, or steps. These validate PostgreSQL RLS/RPC behavior but do not replace end-to-end browser/API authentication tests.
- A clean isolated replay of the earlier 25-file migration inventory completed successfully in run `38322852271` on commit `71fe8e74e5189b565e06cc20eb1360c0abbe04a9`. The new 27-file replay (including write-path hardening) passed migration reset and local status in Actions run `38323682448` on commit `aa02621d45addfb6a038d38acd05df70d4e23a47`; final runner teardown was finishing at the last check.
- The live `workflow_runs_completion_order` constraint matches `CHECK (completed_at IS NULL OR completed_at >= started_at)`; `completed_at` is nullable. This confirms live schema parity, not clean-replay success.
- The run-step INSERT policy now matches the tracked lifecycle logic: dry-run steps require a finished dry-run parent owned by the caller; live-run steps require a running live parent owned by the caller.
- A rollback-only privilege test exposed and then closed a separate integrity bypass: authenticated users could directly update `workflows.definition/version` without version history. Re-ran acceptance against live staging: direct definition updates, direct version inserts, and direct audit inserts are rejected; metadata-only workflow edits are allowed; the validated save RPC creates versions 1 and 2 in sequence, persists two history snapshots and two audit events, and rejects an empty node list. All fixtures were rolled back. The final fix leaves the public save/dry-run RPCs `SECURITY INVOKER`, moves legacy validated bodies to the private schema, uses transaction-local write guards for definitions/version/audit inserts, restricts writes through the intended RPCs, and explicitly checks workspace membership. Direct definition/version updates, non-empty initial definition inserts, direct version snapshots, direct audit inserts, and cross-workspace saves were denied; metadata edits and validated save/dry-run RPCs succeeded. All fixtures were rolled back.
- The redundant second completion-timestamp migration is not present in the current branch tree. The canonical tracked file is `20261012232845_aivanta_workflow_run_completion_timestamp_parity.sql`, matching the remote ledger name. No duplicate ledger entry was created.
- Rechecked scheduler RPC ACLs after the policy forward-fix: scheduler claim/renew/finish/record functions are not executable by `anon` or `authenticated` and are executable by `service_role`; dry-run and save-definition RPCs are executable by `authenticated` and not by `anon`. Security advisor returned no findings after the policy fix.
- The preview deployment for branch commit `71fe8e74e5189b565e06cc20eb1360c0abbe04a9` is `READY`. Newer docs-only deployment status should be checked independently; it does not alter the app migration replay. Earlier READY deployment health check returned HTTP 200 from `/api/health`.

## Staging-only repair execution plan (not yet executed)

The current remote ledger has been re-queried and still contains exactly these 24 legacy versions: `20261012224509`, `20261012224541`, `20261012224946`, `20261012224955`, `20261012224957`, `20261012224959`, `20261012225002`, `20261012225005`, `20261012225024`, `20261012225038`, `20261012225729`, `20261012225813`, `20261012230426`, `20261012230503`, `20261012230528`, `20261012230613`, `20261012230649`, `20261012230922`, `20261012232845`, `20261012233319`, `20261012234256`, `20261012234426`, `20261012235026`, and `20261012235126`.

The canonical local source versions are the 29 filenames in the inventory above. Once a staging-linked CLI session is available, the safe metadata-only normalization is:

1. Confirm `supabase link --project-ref ygclofqxtztnynkljipj` targets **staging**, then run `supabase migration list` and capture the output. Do not proceed if the linked ref is anything else.
2. Run a linked schema diff and review it against the tracked migration chain. Any unexplained schema delta blocks repair; do not blindly apply a generated diff.
3. After the mapping/schema comparison is signed off, remove the 24 legacy ledger rows with `supabase migration repair <all-24-legacy-versions> --status reverted`.
4. Register the 29 canonical source versions with `supabase migration repair <all-29-source-versions> --status applied`.
5. Run `supabase migration list` again and require every local source version to match remote, with no unmatched legacy remote versions. Then rerun the clean replay workflow and read-only catalog/security checks.

`migration repair` changes migration-history metadata; it does not apply or reverse the SQL schema. The repair must therefore happen only after schema equivalence is established. This sequence has **not** been executed because the available connected tools do not expose the Supabase CLI repair command or a staging-linked CLI session. Do not substitute direct writes to `supabase_migrations.schema_migrations`, a remote reset, or blind `db push`.

## Remaining work before any remote history repair

- [x] Clean-replay the prior 25-file chain in isolated local Supabase; database reset and final Supabase status passed on commit `71fe8e74e5189b565e06cc20eb1360c0abbe04a9`.
- [x] Clean-replay the 27-file chain, including write-path hardening, in isolated local Supabase; `supabase db reset --local` and `supabase status` passed in Actions run `38323682448` at commit `aa02621d45addfb6a038d38acd05df70d4e23a47`.
- [x] Track/apply FK index parity for the three extra live indexes and restore the missing workflow-version history index; catalog names/definitions now align with all 18 explicit source indexes.
- [x] Clean-replay the current 29-file chain; `supabase db reset --local`, `supabase status`, and teardown passed in Actions run `38324304643` at commit `8b4b4248b2f937e510e8c6cbab0a96592fe42c77`.
- [ ] Finish line-by-line mapping of all 24 remote ledger entries to the 29 source migrations; the initial baseline and index ledger rows are grouped candidates, not final approvals.
- [x] Capture and inspect live table/column inventory, constraints/FKs, indexes, triggers, RLS policies, function definitions/search paths, and table/function ACLs. Security advisor returns zero findings; scheduler ACLs are service-role-only.
- [ ] Compare remaining source DDL bodies against the live catalog, including the consolidated baseline, index groups, and every scheduler RPC body.
- [ ] Distinguish equivalent consolidated migrations from genuine missing or extra DDL.
- [ ] Complete an explicit staging-only migration history repair using Supabase CLI `migration repair` after the source-to-ledger mapping is reviewed. No blind `db push`, manual ledger inserts, or remote reset. The available Supabase connection exposes no migration-repair action, so do not claim this gate complete until an approved staging CLI session is available.
- [x] Run rollback-only PostgreSQL RLS acceptance tests using two separate test users/workspaces; cross-workspace reads and writes denied, authorized live-run step insert allowed, and all test fixtures rolled back.
- [x] Run rollback-only authenticated `save_workflow_definition` and `record_workflow_dry_run` tests; version/run history and audit events persisted correctly inside the transaction and were fully rolled back afterward.
- [x] Verify direct writes cannot bypass definition validation, version history, or audit integrity; only metadata updates remain directly editable, and cross-workspace RPC access is denied.
- [ ] Run full authenticated staging API/browser tests with actual sign-in sessions.
- [ ] Verify Supabase Auth redirect allow-list and protected-preview smoke tests using approved access. Do not weaken Vercel SSO protection.

No remote database mutation is authorized by this reconciliation document. Production remains untouched.


## Live audit refresh — 2026-10-13

Read-only checks were rerun directly against staging project `ygclofqxtztnynkljipj` after the 29-file clean replay. These results refresh the live evidence above; they do not reconcile migration history.

- Remote project reports `ACTIVE_HEALTHY` on PostgreSQL 17.
- Remote migration ledger still has exactly 24 entries; canonical branch still has 29 tracked migration files. **History reconciliation remains open.**
- Live catalog summary: 8 public tables; RLS enabled on 8/8; 23 public RLS policies; 0 table grants to `anon`; 23 table grants to `authenticated`; 30 public indexes; 6 non-internal public triggers; 7 public functions.
- Four public functions are `SECURITY DEFINER`: `claim_due_workflow_schedules`, `finish_workflow_schedule_claim`, `record_scheduled_workflow_run`, and `renew_workflow_schedule_claim`. Each has an empty `search_path` and an ACL restricted to `postgres` and `service_role`. The public save and dry-run RPCs are `SECURITY INVOKER`; their execute ACL includes `authenticated` and `service_role`, not `anon`. The trigger helper `set_updated_at` is not executable by `anon` or `authenticated`.
- All 23 live RLS policies were read and reviewed. The workflow-step INSERT policy checks workspace membership, the parent run/workspace relationship, creator ownership, and allowed mode/status lifecycle combinations. Workflow, version, audit, schedule, workspace, and membership policies are present.
- Security advisor remains clear: **0 findings**.
- Performance advisor reports 12 informational `unused_index` notices only. The staging tables have no representative workload yet; do not remove those indexes just to clear an informational notice.
- GitHub Actions run `38324304643` was rechecked: the clean local Supabase replay job completed successfully, including migration reset/replay, local status confirmation, and teardown.

## Updated Phase 2 gate status

**Core database schema/security checks: GREEN.** The isolated 29-migration replay is green; live RLS coverage and grants are green; the security advisor is green; prior rollback-only isolation/RPC/scheduler acceptance tests remain recorded above.

**Phase 2 overall: NOT YET CORE-CODE GREEN / NOT CLOSED.** Remaining hard gates are (1) line-by-line confirmation of remote DDL equivalence before any metadata-only migration-history repair, and (2) authenticated staging API/browser smoke tests plus Auth redirect/protected-preview verification. The current connected tools can query staging and inspect GitHub, but do not expose the Supabase CLI migration-repair operation or an authenticated browser session. No remote migration-history mutation has been made in this refresh. Production remains untouched.


## Preview smoke refresh — 2026-10-13 00:19 UTC

The latest Vercel preview for branch commit `12d85b595cb1b0679616570f0e95d23c3b51ce42` is `READY` at `ai-automation-cnju9wvxy-veerex-org.vercel.app`. Read-only/request-safe checks:

- `GET /api/health`: **PASS**, HTTP 200, JSON `{"status":"ok","service":"aivanta"}`.
- `GET /api/internal/scheduler`: **FAIL-CLOSED as expected**, HTTP 503 with `Scheduler authentication is not configured.`. Scheduler remains safely disabled; do not enable it until secret configuration and authorized verification are complete.
- `GET /api/workflows/actions`: blocked by Vercel deployment authentication after bypass retry; no application-level status could be observed.
- `GET /api/ai/generate-workflow`: HTTP 405 because this endpoint requires POST; the connected Vercel fetch action cannot issue a custom POST, so this is not counted as an application smoke pass.

This proves preview deployment health but **does not pass the full smoke suite**. Authenticated API/browser checks remain blocked by preview access and the available fetch action's method limitation. No secrets were read or changed, and production was not touched.

## Follow-up read-only verification — 2026-10-13

A further read-only pass against staging project `ygclofqxtztnynkljipj` confirmed:

- Security advisor still reports **zero findings**.
- The live migration ledger remains at **24 entries**; this is not evidence of reconciliation with the 29-file source chain.
- The eight public application tables remain RLS-enabled. Verbose table metadata reconfirmed the workspace, workflow, version, run, run-step, schedule, and audit foreign-key relationships and the expected validation constraints. Staging currently has no application rows.
- The four scheduler worker functions remain `SECURITY DEFINER` with an explicitly empty `search_path`; the public save-definition and dry-run RPCs remain `SECURITY INVOKER` with an empty `search_path`. The scheduler functions are still treated as service-role-only based on the prior full ACL inspection; this pass queried function definitions/configuration but did not re-run the complete ACL matrix.
- The index catalog confirms the expected schedule due/creator/workspace indexes and the workflow-version history index exist. It also shows both `workspace_members_user_id_idx` and `workspace_members_user_idx`; do not drop either until their origin and workload value are established.
- The current branch head docs commit `396d10a455685e4403768c52a9121d988cb411a0` does not yet appear in the Vercel deployment list for this branch. The latest matching READY deployment still points to `12d85b595cb1b0679616570f0e95d23c3b51ce42`. This is a docs-only delta, not a schema or application-code change; no deployment was forced.

### Decision

No remote DDL or migration-ledger changes were made. The next safe gate is still a source-to-catalog review detailed enough to approve or reject each grouped legacy ledger mapping, followed by staging-linked CLI history normalization. Authenticated browser/API acceptance and scheduler secret configuration also remain open. Production remains untouched.

## CI blocker diagnosis — 2026-10-13

Inspected GitHub Actions run `38324670662` for the new read-only staging schema-diff workflow. The run did **not** discover a schema difference: it stopped before linking or running the diff because both environment variables were empty in the runner:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

The workflow correctly failed closed at its credential preflight; the migration list and remote schema diff steps were skipped. This means there is still no CI-generated remote-vs-replay diff artifact. The isolated 29-file local replay remains green in run `38324304643`.

The Vercel commit status for the docs-only commit `b5208c3f5ee9804c03c3008b118ddd0970f7e591` reports deployment rate limiting and asks to retry in 24 hours. This is a hosting/build quota status, not a Supabase schema failure. No production deployment or remote database mutation was attempted.

**Action required to unblock the next gate:** populate the two staging-only GitHub environment secrets in the repository's `aivanta-staging` environment, then rerun the manually dispatched schema-diff workflow. Do not put either secret in source control, logs, or chat. Only after the resulting migration list and schema diff are reviewed should any migration-history repair be considered.


## Ledger repair workflow prepared — 2026-10-13 02:02 UTC

The branch now includes `.github/workflows/supabase-staging-ledger-reconciliation.yml` (commit `966cd1d50247f788c17291f3f4eb80087c73bed4`). It is **manual-dispatch only** and requires the boolean `confirm_ledger_repair=true`. It is scoped to the fixed staging project ref `ygclofqxtztnynkljipj`, uses only the `aivanta-staging` GitHub environment secrets, and will fail closed unless the exact reviewed local/remote migration inventories match.

Current reviewed inventories from the latest `supabase migration list` output:
- 31 tracked source migrations.
- 24 remote ledger versions.
- One version shared by both sides: `20261012232845`.
- 30 tracked versions absent from the remote ledger.
- 23 legacy remote ledger versions absent from the tracked source chain.

Before making ledger changes, the workflow starts isolated local Supabase, clean-replays all tracked migrations, confirms the exact source and remote version sets, and requires `supabase db diff --linked --schema public,private` to report no schema changes. It then uses the Supabase CLI's metadata-only `migration repair` command to mark the 23 legacy remote versions reverted and register the 30 missing tracked versions as applied. It finally requires every local and remote migration row to match and uploads before/after evidence.

**Important:** committing the workflow did not execute the repair. The available GitHub connector can inspect runs and create commits, but cannot dispatch a workflow or run the Supabase CLI repair command directly. The ledger remains unreconciled until the manual workflow is run with its confirmation input set to true and its post-repair verification passes. Do not claim Phase 2 closed before that run and the authenticated staging/browser acceptance gates are complete. Production remains untouched.
