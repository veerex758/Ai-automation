# Supabase Staging Backup and Recovery Drill

## Purpose

Provide a safe, repeatable checklist for proving that Aivanta's staging database can be recovered. This document is a runbook, not evidence that a backup exists or that a restore has passed. The drill remains an operator gate until its evidence is recorded.

## Safety rules

- Use staging-only data and credentials. Never restore over production or the active staging database.
- Restore into a separate, isolated recovery project/database with its own credentials.
- Do not paste database URLs, passwords, access tokens, service-role keys, or backup contents into GitHub issues, logs, or screenshots.
- Keep Vercel preview protection enabled. Do not enable scheduled execution or live email/provider actions during the drill.
- Stop if the source project, destination, backup timestamp, or environment cannot be positively identified.
- Obtain the project owner's approval before creating billable resources, changing retention settings, or deleting a temporary recovery environment.

## A. Confirm backup availability (operator)

- [ ] In the Supabase dashboard, identify the exact staging project and project reference.
- [ ] Check which backup mechanism is actually available for this project (for example, provider-managed backups or an approved export process); do not assume a feature is enabled.
- [ ] Record the configured backup method, retention window, latest successful backup/export timestamp, and any documented limitations.
- [ ] Confirm the backup is from the intended staging project and predates the drill.
- [ ] Store any backup artifact only in the approved private location with restricted access; record a reference/identifier, never credentials or raw secrets.
- [ ] If there is no usable backup or export, mark the drill BLOCKED and resolve the backup plan before attempting restoration.

## B. Restore into an isolated recovery target

- [ ] Create or select a separate, temporary recovery project/database. Verify its project reference and URL before importing anything.
- [ ] Confirm it cannot route to production data and does not share production credentials.
- [ ] Restore/import the selected backup using the approved provider procedure.
- [ ] Do not copy production secrets or enable live external integrations. Use no-op/test credentials where application configuration is required.
- [ ] Record start/end timestamps, operator, source backup identifier, destination project reference, and any warnings—without recording secrets.
- [ ] If the provider restore fails or target identity is ambiguous, stop and record the exact non-sensitive error.

## C. Validate the restored database

- [ ] Compare the restored schema with the repository's tracked Supabase migrations; investigate unexpected drift before proceeding.
- [ ] Verify migration history is coherent with the restored schema. Do not edit migration history merely to make a check pass.
- [ ] Confirm the expected core public tables exist and Row Level Security is enabled on each.
- [ ] Review table privileges and relevant RLS policies, especially workspace membership, workflow ownership, workflow run history, and schedule ownership.
- [ ] Confirm no anonymous role has unintended access to private workspace/workflow data.
- [ ] If representative staging fixtures are approved, test workspace isolation with two separate test users/workspaces and verify neither can read or mutate the other's records.
- [ ] Keep scheduler and live-provider execution disabled; validate any queued/scheduled records without dispatching external actions.
- [ ] Record each check as PASS, FAIL, or NOT RUN, with safe evidence references and the exact recovery target.

## D. Recovery acceptance criteria

The drill is **GREEN** only when all applicable checks above pass and the owner can confirm:

1. The selected backup/export was available and its provenance is known.
2. Restore completed into the isolated recovery target without overwriting active staging or production.
3. Schema/migration coherence, RLS, privileges, and workspace isolation were validated.
4. No external/live workflow actions were triggered.
5. Recovery duration, gaps/limitations, and any follow-up actions are documented.

If a check cannot be run because credentials, backup availability, dashboard access, or approved fixtures are missing, mark the drill **BLOCKED** rather than assuming success.

## E. Evidence record template

Record this in the shared Aivanta verification ledger:

`[GREEN|YELLOW|RED|BLOCKED] Supabase staging recovery drill — source project reference — backup identifier/timestamp — isolated recovery project reference — commit/schema version — UTC start/end — checks passed/failed/not run — evidence links — follow-up owner`

Never include passwords, access tokens, service-role keys, database connection strings, customer data, or backup files in the ledger.

## Cleanup

After validation and owner approval, remove the temporary recovery resources and test fixtures according to the project's data-retention policy. Confirm the active staging project and production project remain unchanged. Record cleanup completion and any retained evidence location.
