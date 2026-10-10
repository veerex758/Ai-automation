# Level 7 — Security and end-to-end verification

This checklist covers the first Aivanta MVP workflow path. Automated CI must pass before merge. Real provider delivery is deliberately excluded from CI so tests cannot send customer email.

## Automated checks

Run these commands in CI:

- `npm test` — workflow-definition validation, dry-run behavior, and Resend adapter safety.
- `npm run lint` — lint the application and tests.
- `npm run typecheck` — TypeScript validation.
- `npm run build` — production build.

Coverage includes malformed workflow definitions, safe condition-path evaluation, dry-run side-effect guarantees, recipient allowlist normalization, fixed Resend endpoint, provider-error sanitization, idempotency header propagation, and refusing redirects.

## Security controls verified against the dedicated Supabase project

- RLS is enabled for `workflow_runs` and `workflow_run_steps`.
- Live runs can only be created by authenticated workspace members as their own `running` records.
- Only the run creator can finalize their live run.
- Step inserts must belong to a run created by the authenticated user in the same workspace; live steps are only written while the run is `running`.
- Workspace membership is required for run and step access.
- Supabase security advisor should report no lints.

The database migration `20261010210000_harden_live_run_step_ownership.sql` enforces the step ownership rule. Performance advisor unused-index notices are informational on this early, low-volume database; do not remove indexes without workload evidence.

## Manual staging verification before enabling real email

Use a staging deployment and a verified sender. Keep `AIVANTA_LIVE_EXECUTION_ENABLED=false` until the test plan is approved.

1. Unauthenticated live-run request returns `401`.
2. With live execution disabled, an authenticated live-run request returns `503` and no provider request is made.
3. With the flag enabled but credentials or allowlist missing, readiness remains false and the run is blocked.
4. A recipient outside `AIVANTA_LIVE_EMAIL_RECIPIENTS` is rejected before contacting Resend.
5. A draft/inactive workflow, non-manual trigger, invalid definition, or multiple actions is rejected before contacting Resend.
6. An approved manual-trigger email workflow sends to a designated test inbox and records a live run plus step history.
7. Repeating the same `Idempotency-Key` returns the prior run and does not send a second email.
8. A user cannot read or alter runs in a workspace they do not belong to, and cannot insert steps into another user's run.
9. More than 10 live runs in an hour for the same user is rejected.
10. Confirm run history reflects success and provider rejection accurately. For any timeout or persistence failure, inspect history before retrying.

Do not use a real customer recipient for staging. Real delivery and production environment configuration remain a deployment gate, not a CI test.
