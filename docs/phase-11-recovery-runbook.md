# Phase 11.4 — Recovery and incident runbook

This runbook is intentionally operational and read-only until an authorized operator executes a reviewed step. It does not claim that backups, alerts, or recovery drills have already been configured.

## 1. Triage a failed API request

1. Capture the UTC timestamp, route, HTTP status, and `x-request-id` response header.
2. Search hosting logs for the matching request ID. Use the structured event's route, outcome, status code, duration, and stable error code.
3. Do not paste prompts, workflow definitions, access tokens, authorization headers, provider payloads, or personal data into tickets.
4. If there is no matching event, check the deployment's log availability and retention before concluding that the request never reached the app.
5. Record the observed symptom, impact, deployment revision, and the action taken.

## 2. Scheduler incident handling

The scheduler must remain dry-run only until the separate execution-safety phase explicitly authorizes side effects.

- **401:** verify the caller's configured cron secret and request authorization. Never print the secret while debugging.
- **503 / auth not configured:** verify the deployment's required secret names are present in the intended environment; do not expose their values.
- **500 / claim failed:** inspect database reachability and the RPC error context available to the operator. Avoid repeatedly triggering the scheduler until the cause is understood.
- **Claim finalization failed:** a lease may remain until expiry. Confirm lease expiry and subsequent safe reclaim behavior before attempting manual repair.
- **Repeated workflow failures:** compare stable error codes and bounded durations; inspect a sanitized workflow fixture in a non-production environment.

Never manually mark a schedule successful just to clear an alert. Do not change lease or retry settings in production without a reviewed migration/change plan.

## 3. Backup and recovery drill

Before production launch, an authorized operator must:

1. Confirm the Supabase backup/PITR plan available to this project, retention window, and responsible owner.
2. Record the last successful backup timestamp and the documented recovery-point objective.
3. Restore a backup to an isolated non-production project or otherwise approved recovery environment.
4. Verify schema/migrations, workspace ownership boundaries, representative workflow and schedule records, and application connectivity.
5. Record restore duration, observed data loss window, validation results, and corrective actions.
6. Confirm the recovery environment is isolated and securely dispose of temporary restored data according to policy.

A backup being enabled is not proof that recovery works. Do not run a destructive restore against production as a test.

## 4. Incident closure

- Attach the sanitized request ID, UTC timestamps, deployment revision, and stable error code.
- State whether the issue was reproduced and whether the recovery path was tested.
- Note any configuration or database changes and their approvals.
- Re-run relevant CI checks and staging smoke tests after a code fix.
- Close the incident only when impact is mitigated and follow-up actions have an owner.

## Evidence record template

- Date/time (UTC):
- Environment / deployment revision:
- Symptom and user impact:
- Route / HTTP status / request ID:
- Stable error code:
- Backup timestamp / recovery point (if relevant):
- Recovery steps and elapsed time:
- Data-integrity and access-control checks:
- Result / follow-up owner:

Do not store secret values, raw prompts, personal data, or workflow payloads in this record.
