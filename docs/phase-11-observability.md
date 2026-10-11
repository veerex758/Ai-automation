# Phase 11 — Reliability, security, and observability

Phase 11 hardens Aivanta's operational behavior without enabling new external side effects.

## Slice 11.1 — Safe structured operational events

- Use a validated request ID for correlating server logs and response headers.
- Emit only allow-listed operational fields: event, route, outcome, status, duration, bounded counters, and stable error codes.
- Never log request bodies, workflow prompts/definitions, emails, authorization headers, provider responses, or secrets.
- Return the request ID to callers so an operator can correlate a report with server logs.
- Keep scheduler execution in dry-run mode; observability must not change execution permissions.

## Operational checks still required

- Configure alerting and retention in the hosting provider.
- Verify health/readiness endpoints against the deployed environment.
- Confirm backups and test a recovery procedure.
- Enable Supabase leaked-password protection and review security/performance advisor findings.
- Run authenticated staging checks for workspace isolation, AI generation, scheduler authentication, and run history.

A successful CI run validates code paths and regression tests; it does not replace production configuration review, staging verification, or launch approval.
