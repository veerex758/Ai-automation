# Phase 11 — Reliability, security, and observability

Phase 11 hardens Aivanta's operational behavior without enabling new external side effects.

## Slice 11.1 — Safe structured operational events

- Use a validated request ID for correlating server logs and response headers.
- Emit only allow-listed operational fields: event, route, outcome, status, duration, bounded counters, and stable error codes.
- Never log request bodies, workflow prompts/definitions, emails, authorization headers, provider responses, or secrets.
- Return the request ID to callers so an operator can correlate a report with server logs.
- Keep scheduler execution in dry-run mode; observability must not change execution permissions.

## Slice 11.2 — Scheduler failure containment

- Treat returned RPC errors and thrown transport exceptions consistently when claiming scheduled work.
- Contain finalization transport errors and leave lease expiry as the recovery mechanism for unfinalized claims.
- Emit bounded per-workflow failure durations without logging workflow contents or identifiers.
- Keep scheduled processing in dry-run mode; retries must not introduce duplicate external side effects.

## Operational checks still required

- Configure alerting and retention in the hosting provider.
- Verify health/readiness endpoints against the deployed environment.
- Confirm backups and test a recovery procedure.
- Enable Supabase leaked-password protection and review security/performance advisor findings.
- Run authenticated staging checks for workspace isolation, AI generation, scheduler authentication, and run history.

A successful CI run validates code paths and regression tests; it does not replace production configuration review, staging verification, or launch approval.

## Phase 11.3 — Security review findings (read-only)

Last reviewed: 2026-10-11

- **Action required:** Supabase Security Advisor reports leaked-password protection is disabled. Enable it in the Supabase Auth settings after confirming the intended password policy; this repository tool connection does not expose an Auth-settings update operation, so no production setting was changed here.
- **Performance follow-up:** Supabase reports missing covering indexes for `workflow_schedules_created_by_fkey` and `workflow_schedules_workspace_id_fkey`. Review query patterns and existing indexes before adding indexes through a reviewed migration.
- **Do not remove indexes solely because the advisor labels them unused.** Low traffic or recent project usage can make legitimate indexes appear unused; review query plans and workload history first.
- Re-run Supabase advisors after any reviewed database/configuration change and record the result. These findings are not evidence that data was breached.
