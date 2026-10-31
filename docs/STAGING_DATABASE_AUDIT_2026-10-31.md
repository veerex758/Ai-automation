# Aivanta staging database audit — 2026-10-31

Target: Supabase project `aivanta-staging` (`ygclofqxtztnynkljipj`), region `eu-west-1`, PostgreSQL 17.11.

This is a read-only audit. No schema, data, Auth settings, credentials, or project settings were changed.

## Snapshot

- Project status: `ACTIVE_HEALTHY`.
- Public base tables: 13.
- Recorded migrations: 39, latest `20261031032910 aivanta_workspace_integration_grant_hardening`.
- Current sample counts: 2 workspaces, 6 workflows, 8 workflow runs, 24 workflow run steps, 4 workflow versions, 12 audit events. Counts are a snapshot, not capacity evidence.
- One Supabase development branch named `main` is listed with status `MIGRATIONS_FAILED` while its preview project status is `ACTIVE_HEALTHY`. Investigate branch migration logs/status before relying on this branch; do not reset it without review.
- PostgreSQL 17 and `pgmq` extension availability are present, but extension availability alone does not mean Aivanta has implemented or configured a durable queue.

## Security findings

Supabase Security Advisor reports:
1. Four tables with RLS enabled but no policies: `google_connections`, `webhook_endpoints`, `webhook_event_receipts`, `workspace_integration_secrets`.
2. Leaked-password protection is disabled.

Follow-up inspection found the four no-policy tables have grants only to `postgres` and `service_role`; no `anon` or `authenticated` table grants were found. This is consistent with intentional server-only access and is safer than adding broad client policies. Keep these tables server-only; verify API handlers use trusted server credentials and never return encrypted secret payloads. Treat the advisor warning as an intentional access-model exception that should be documented and regression-tested, not fixed by adding generic RLS policies.

Enable leaked-password protection in the staging Auth settings after confirming the desired Auth configuration; this audit toolset did not expose an Auth settings update action, so no setting was changed.

Existing workspace-facing RLS policies use workspace membership/admin/owner helper predicates. Continue testing cross-workspace isolation with two independent authenticated users; catalog inspection alone does not prove the policies are free of every IDOR path.

## Performance findings

Supabase Performance Advisor reports five unindexed foreign keys:
- `google_connections.connected_by`
- `webhook_endpoints(workflow_id, workspace_id)`
- `webhook_endpoints.created_by`
- `webhook_endpoints.workspace_id`
- `workspace_integrations.created_by`

Create covering indexes for these relationships in a reviewed migration after checking existing index definitions and query patterns. The advisor also reports 12 unused indexes; do not remove them solely from a low-traffic staging snapshot. Re-evaluate after representative load tests.

## Migration and release concerns

- Staging has 39 recorded migrations through 2026-10-31.
- The connected Supabase development branch reports `MIGRATIONS_FAILED`; diagnose the failure before branch merge/reset or before treating Supabase branch previews as a reliable release gate.
- Compare this migration history to the exact Git branch intended for staging, not only the repository's `main`.
- Never assume staging parity from migration count alone; verify migration names, schema objects, grants, RLS, functions, triggers and constraints.

## Next safe actions

1. Inspect the failed Supabase branch migration logs and identify the exact failed migration.
2. Compare the staging migration history with the consolidated Git branch.
3. Add FK covering indexes through a reviewed migration; verify with advisors afterward.
4. Enable leaked-password protection in staging Auth settings.
5. Add regression tests proving server-only tables cannot be accessed by `anon` or `authenticated`, while trusted server handlers can perform only intended operations.
6. Run cross-workspace RLS tests and end-to-end workflow save → dry-run → run-history acceptance.
7. Keep production isolated until the staging release gate is green.
