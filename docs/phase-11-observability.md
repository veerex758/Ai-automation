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

- [x] CI passed for the current PR head before this evidence-only documentation refresh: workflow validation, lint, type-check, and production build all succeeded.
- [x] Preview deployment was ready and the health endpoint was smoke-tested successfully on 2026-10-11: HTTP 200, body `{"status":"ok","service":"aivanta"}`, UUID `x-request-id`, and `Cache-Control: no-store`.
- [x] Unauthenticated scheduler safety gate was tested on the preview: HTTP 503 with `SCHEDULER_AUTH_NOT_CONFIGURED`-equivalent response text ("Scheduler authentication is not configured."), UUID `x-request-id`, and `Cache-Control: no-store`. No scheduler work was claimed or executed by this unauthenticated request.
- [ ] Authenticated staging checks cover workspace isolation, AI workflow generation, scheduler authentication with an authorized secret, and run history.
- [ ] Scheduler remains dry-run; verify no email delivery or external workflow side effects occur in the deployed staging environment.
- [ ] Hosting alerting and log retention are configured and ownership is assigned. The project has no configured Vercel Drains; webhook inspection is blocked by a Vercel API 403, so alerting configuration remains unverified.
- [ ] Supabase leaked-password protection is reviewed and enabled by an authorized operator.
- [ ] Security/performance advisor findings are reviewed; any index changes go through a separate reviewed migration.
- [ ] Backup retention is confirmed and a non-production restore drill has passed.
- [ ] Final evidence, known limitations, and rollback owner are documented before production promotion.

### Verification snapshot — 2026-10-11

- Verified PR head at the time of checks: `001e3bac0c437362a18d68d5b813f8eaf3219e60`; its GitHub Actions run [`38127073319`](https://github.com/veerex758/Ai-automation/actions/runs/38127073319) completed successfully, including workflow validation, lint, type-check, and production build. This document update creates a new documentation-only commit; re-check CI and the deployment for that new head before treating the refreshed PR head as code-green.
- Vercel preview deployment [`CV4ggC2FN4oiHMSZBw5krDV2hJj6`](https://vercel.com/veerex-org/ai-automation/CV4ggC2FN4oiHMSZBw5krDV2hJj6) was `READY` for that head. Authorized preview fetch returned HTTP 200 with `Cache-Control: no-store` and UUID `x-request-id`.
- An unauthenticated request to `/api/internal/scheduler` returned HTTP 503, `Cache-Control: no-store`, and UUID `x-request-id`; scheduler authentication is not configured in that preview environment. This is a safe rejection, not evidence that authenticated scheduler processing works.
- A read-only Vercel Drains query returned no configured drains. A webhook-list query returned 403, so webhook/alerting configuration is not fully verified. No runtime logs were returned for the last 30 minutes; this is not evidence that logging or retention is configured.
- Supabase project status is `ACTIVE_HEALTHY`. Security Advisor reports leaked-password protection disabled, two unindexed foreign keys, and 11 indexes marked unused. No production Auth setting or database schema was changed; unused indexes should not be removed without workload review.
- Authenticated staging checks, alerting/log-retention review, and backup restore drill have not been performed or verified.

### Operational checks still required

- Obtain an authorized staging identity and credentials, then run workspace-isolation, AI-generation, scheduler-authentication, and run-history checks without exposing secrets.
- Configure and verify scheduler authentication in the intended non-production environment before testing authorized dry-run processing.
- Verify the scheduler remains dry-run in the deployed staging environment and that no email or other external workflow side effects occur.
- Review and configure hosting alerting/log retention as appropriate; the read-only Drains query returned no configured drains, and webhook access could not be verified.
- Have an authorized operator enable Supabase leaked-password protection after reviewing the intended password policy.
- Review the advisor index findings and use a reviewed migration if query plans justify changes.
- Confirm backup retention and complete a non-production restore drill.

A successful CI run and health smoke test validate code and basic deployment availability; they do not replace authenticated staging verification, production configuration review, or launch approval. Do not enable scheduled side effects or promote to production based on CI alone.
