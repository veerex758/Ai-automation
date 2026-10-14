# Supabase setup (Aivanta)

This directory contains version-controlled database migrations for Aivanta. Apply them only to an explicitly approved Aivanta environment. Never point the CLI or application at another application's project.

## Current project reference

- Recreated **staging** project ref: `ygclofqxtztnynkljipj`
- Retrieve the project URL and publishable key from that project's Supabase dashboard. Do not derive production settings from old documentation.
- The former project reference `xymbwkegcpjxlgclqiop` is historical and must not be used for the recreated staging environment.
- Treat staging and production as separate environments. Do not copy production data or credentials into staging.

## Before any database operation

1. Confirm the active Supabase project ref in the CLI/dashboard and compare it with the intended environment.
2. Confirm the local migration files and remote migration ledger agree. Review any mismatch before changing migration metadata.
3. Use a disposable local database for clean migration replay and schema-diff checks.
4. For staging, inspect the proposed migration and its effects first; take an approved backup/snapshot when available.
5. Do not run a reset, destructive repair, migration-ledger repair, or migration push against a remote project without explicit operator authorization.
6. Record the migration version, target environment, command/result, and schema-diff evidence in the shared Aivanta verification ledger.

A successful local replay does not prove that a remote project has the same schema. A matching migration ledger does not by itself prove row-level security or grants are correct.

## Security requirements

- Browser clients may use only the publishable key. Never commit database passwords, service-role keys, access tokens, or secret API keys.
- Keep privileged credentials server-side and in the intended environment's secret store.
- Every customer/workspace table must have Row Level Security enabled and policies that enforce the authenticated user's workspace membership.
- Do not grant anonymous users access to customer tables. Review table-level and column-level grants as well as RLS policies; RLS does not replace SQL privileges.
- Security-definer functions must be narrowly scoped, use a fixed search path, and have execute privileges restricted to the required roles. Prefer invoker rights when possible.
- Verify workspace ownership and membership behavior under authenticated and unauthenticated roles, including concurrent creation/recovery paths.
- Keep workflow execution, scheduler side effects, and provider calls disabled during schema verification.

## Environment configuration

Configure the Supabase project URL and publishable key in the appropriate local or deployment environment variables. Keep service-role keys, database passwords, and other privileged secrets out of source control, client bundles, logs, and issue comments. Do not trigger a deployment merely to validate a documentation or code change.

## Acceptance boundary

Database changes are code-side complete only after migration replay, schema comparison, security-policy/grant checks, and CI evidence are recorded. Staging acceptance additionally requires authorized environment-specific verification. Do not describe the project as production-ready solely because CI or the Supabase security advisor is green.
