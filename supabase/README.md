# Supabase setup (Aivanta)

This folder contains version-controlled migrations for Aivanta. The approved staging project is `aivanta-staging` (ref `ygclofqxtztnynkljipj`) and is for read-only verification in this workflow. Do not use legacy project references or run migration repair/reset/apply commands against staging.

For clean migration replay, use a disposable local Supabase project only. Keep project URLs and credentials in environment configuration rather than hard-coding them in this repository.

## Migrations
1. `20261010180000_aivanta_workspace_workflow_foundation.sql` — workspaces, memberships, workflows, workflow versions, audit events, triggers, indexes, and RLS.
2. `20261010180100_aivanta_security_performance_hardening.sql` — foreign-key indexes, account deletion compatibility, and restricted trigger-function execute privileges.

These migrations have been applied to the dedicated project and checked afterward. All five public tables have RLS enabled; Supabase's security advisor returned no findings at verification time.

## Security
- Browser clients may use only the publishable key. Never commit database passwords, service-role keys, or secret API keys.
- The `private` schema holds RLS helper functions with a fixed search path; only authenticated users may execute them.
- All public tables deny `anon` access and require authenticated RLS policies.
- Create a workspace with `owner_id = auth.uid()`, then add the creator to `workspace_members` with role `owner`. The workspace owner is also recognized by RLS before membership insertion.
- Workflow execution, OAuth integrations, billing, and authenticated application CRUD are not implemented merely by creating these tables.

Configure the project's URL and publishable key through local/deployment environment variables; keep private credentials in deployment secrets.


## Disposable local migration replay

From the repository root, with Docker available and the Supabase CLI installed:

```sh
npx supabase init                 # only if supabase/config.toml is absent
npx supabase db start
npx supabase db reset --local --no-seed
npx supabase migration list --local
npx supabase stop --no-backup
```

This workflow is local-only. Do not run `supabase link`, use `--linked`, push migrations, or repair remote migration history as part of a replay check. The GitHub Actions migration-replay workflow runs the same disposable-local sequence for migration changes.


## Durable execution queue

The durable execution queue is an additive migration. Its queue, checkpoint, and dead-letter tables and RPCs are server-role only. The worker currently executes side-effect-free dry-runs; provider side effects must not be retried until provider-specific idempotency and reconciliation are implemented. See [docs/execution/durable-queue.md](../docs/execution/durable-queue.md) for the operational contract and CI PostgreSQL failure-injection coverage.
