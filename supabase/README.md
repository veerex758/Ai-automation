# Supabase setup (Aivanta)

This folder contains version-controlled migrations for Aivanta. The connected project below is the authoritative **staging** database for Preview validation. Do not run migrations against Production or any other Supabase project without explicit approval and a separate identity check.

- Staging project name: `aivanta-staging`
- Staging project ref: `ygclofqxtztnynkljipj`
- Staging API URL: `https://ygclofqxtztnynkljipj.supabase.co`
- Region: `eu-west-1`

The repository's former reference, `xymbwkegcpjxlgclqiop`, is disconnected and must never be used for Preview configuration. Keep Preview credentials pointed at the connected staging project. Production database identity and credentials must be verified separately before any Production work.

## Migration history and application

Migration files are version-controlled schema changes. The canonical history currently contains 38 versions and matches the read-only staging migration ledger.

Before applying a new migration to staging:
1. Confirm the target project ref is `ygclofqxtztnynkljipj`.
2. Review migration history and schema parity.
3. Validate replay against a clean disposable PostgreSQL/Supabase database.
4. Apply only with explicit approval when the change affects the shared staging database.
5. Verify resulting schema, grants, RLS policies, and Supabase advisors.

Never blindly replay historical migrations onto an existing shared database. Do not use migration repair/reset commands against staging as part of a replay check.

## Security

- Browser clients may use only the publishable key. Never commit database passwords, service-role keys, or secret API keys.
- Server-only credentials must remain in server-side environment variables.
- Public tables must have deliberate RLS policies and least-privilege grants.
- Queue, worker, credential, and other privileged operations must remain server-owned and unavailable to anonymous or authenticated browser roles unless a specific policy is designed and tested.
- Do not infer that a migration has been applied merely because its SQL file exists in the repository.

Configure Preview's URL and publishable key through deployment environment variables. Keep private credentials in deployment secrets and never expose their values in logs or client bundles.

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
