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

- [x] Previous code head (`33a7712f27a6ea4bda66dd2e812083ca0920e565`) passed CI and its preview health endpoint returned HTTP 200 with `x-request-id` and `Cache-Control: no-store`.
- [ ] Latest PR head has a ready preview deployment and a successful live health smoke test. The latest docs-only commit's deployment is ready, but its preview health fetch was blocked by Vercel SSO protection; do not weaken deployment protection to bypass this.
- [ ] Authenticated staging checks cover workspace isolation, AI workflow generation, scheduler authentication, and run history.
- [ ] Scheduler remains dry-run; verify no email delivery or external workflow side effects occur in the deployed staging environment.
- [ ] Hosting alerting and log retention are configured and ownership is assigned.
- [ ] Supabase leaked-password protection is reviewed and enabled by an authorized operator.
- [ ] Security/performance advisor findings are reviewed; any index changes go through a separate reviewed migration.
- [ ] Backup retention is confirmed and a non-production restore drill has passed.
- [ ] Final evidence, known limitations, and rollback owner are documented before production promotion.

### Verification snapshot — 2026-10-11

- Current PR head: `6e3337b7348997f50c19debac5cd83ea9064f73b` (documentation-only update to record verification evidence).
- GitHub Actions run [`38126990903`](https://github.com/veerex758/Ai-automation/actions/runs/38126990903) was still in progress at the last check; workflow validation, lint, type-check, and production build results for this head are not yet confirmed.
- Vercel preview deployment [`96h649oS9Pbq11Co76pKx5wZTDDi`](https://vercel.com/veerex-org/ai-automation/96h649oS9Pbq11Co76pKx5wZTDDi) is `READY` for this head. A direct health fetch of this preview was blocked by Vercel Authentication/SSO protection. The prior code head's preview health smoke test succeeded with HTTP 200, `Cache-Control: no-store`, and a UUID `x-request-id`; the latest docs-only deployment's response headers are not yet independently verified.
- A read-only Vercel Drains query returned no configured drains for the project. A webhook-list query returned 403, so webhook/alerting configuration is not fully verified.
- Supabase Security Advisor still reports leaked-password protection disabled and two unindexed foreign keys. These findings were read-only; no production Auth setting or database schema was changed.
- Authenticated staging checks, alerting/log-retention review, and backup restore drill have not been performed or verified.

### Operational checks still required

- Obtain an authorized way to smoke-test the latest preview through its SSO protection, or record a verified authorized browser test; do not weaken deployment protection just for automated access.
- Run authenticated staging checks for workspace isolation, AI generation, scheduler authentication, and run history.
- Verify the scheduler remains dry-run in the deployed staging environment and that no email or other external workflow side effects occur.
- Review and configure hosting alerting/log retention as appropriate; the read-only Drains query returned no configured drains, and webhook access could not be verified.
- Have an authorized operator enable Supabase leaked-password protection after reviewing the intended password policy.
- Review the advisor index findings and use a reviewed migration if query plans justify changes.
- Confirm backup retention and complete a non-production restore drill.

A successful CI run and health smoke test validate code and basic deployment availability; they do not replace authenticated staging verification, production configuration review, or launch approval. Do not enable scheduled side effects or promote to production based on CI alone.
