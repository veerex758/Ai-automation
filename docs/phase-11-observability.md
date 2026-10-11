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

## Phase 11.3 — Security review findings (read-only)

Last reviewed: 2026-10-11

- **Action required:** Supabase Security Advisor reports leaked-password protection is disabled. Enable it in the Supabase Auth settings after confirming the intended password policy; this repository tool connection does not expose an Auth-settings update operation, so no production setting was changed here.
- **Performance follow-up:** Supabase reports missing covering indexes for `workflow_schedules_created_by_fkey` and `workflow_schedules_workspace_id_fkey`. Review query patterns and existing indexes before adding indexes through a reviewed migration.
- **Do not remove indexes solely because the advisor labels them unused.** Low traffic or recent project usage can make legitimate indexes appear unused; review query plans and workload history first.
- Re-run Supabase advisors after any reviewed database/configuration change and record the result. These findings are not evidence that data was breached.

## Phase 11.4 — Recovery and incident readiness

The operational recovery runbook is in [`docs/phase-11-recovery-runbook.md`](./phase-11-recovery-runbook.md).

- Correlate sanitized structured logs with the response `x-request-id`; do not collect raw prompts, credentials, provider payloads, or workflow contents in incident tickets.
- Triage scheduler authentication, claim failures, and lease-finalization failures using stable error codes and the runbook.
- Confirm backup retention and recovery objectives with the project owner, then complete a restore drill in an isolated non-production environment.
- Verify restored schema, representative data, workspace isolation, and application connectivity; record restore duration and corrective actions.
- No backup configuration or production database state is changed by this repository documentation.

## Phase 11.5 — Release-readiness gates

Phase 11 is not fully operationally complete until the following evidence is recorded. Code checks alone do not satisfy these gates.

- [ ] Latest PR head passes workflow validation tests, lint, type-check, and production build.
- [ ] Vercel preview for the exact PR head is ready and smoke-tested for health, request-ID headers, and no-store response headers.
- [ ] Authenticated staging checks cover workspace isolation, AI workflow generation, scheduler authentication, and run history.
- [ ] Scheduler remains dry-run; verify no email delivery or external workflow side effects occur.
- [ ] Hosting alerting and log retention are configured and ownership is assigned.
- [ ] Supabase leaked-password protection is reviewed and enabled by an authorized operator.
- [ ] Security/performance advisor findings are reviewed; any index changes go through a separate reviewed migration.
- [ ] Backup retention is confirmed and a non-production restore drill has passed.
- [ ] Final evidence, known limitations, and rollback owner are documented before production promotion.

### Verification snapshot

- CI run `38124246333` on head `0d17fbe1c1d9af4444ef776dd10d662fa1804cb2` completed successfully for workflow validation tests, lint, type-check, and build.
- The Vercel PR deployment reported Ready for that same head at the time of verification.
- These results verify the code/preview pipeline only. Authenticated staging checks, hosting alerting/retention, production Auth hardening, and backup recovery remain external operational gates until evidence is recorded.

## Operational checks still required

- Configure alerting and retention in the hosting provider.
- Verify health/readiness endpoints against the deployed environment.
- Confirm backups and test a recovery procedure.
- Enable Supabase leaked-password protection and review security/performance advisor findings.
- Run authenticated staging checks for workspace isolation, AI generation, scheduler authentication, and run history.

A successful CI run validates code paths and regression tests; it does not replace production configuration review, staging verification, or launch approval.
