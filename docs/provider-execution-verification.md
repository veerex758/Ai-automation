# Aivanta provider verification report

Generated from the current provider catalogue, native node registry, worker mapping, and test source files.

## Summary

- Catalogue entries: 100
- Native registry definitions represented in the catalogue: 100
- Catalogue provider operations: 126
- All native registry operations: 146
- Worker operation mappings: 146
- Missing mappings: 0
- Staging migrations: APPLIED (20261106213337_mysql_mongodb_workspace_credentials; 20261106213345_workspace_provider_operation_approvals).
- Database service verification: real MySQL/MongoDB CI integration workflow added; execution result pending GitHub Actions.
- OAuth implementation: provider-specific start/callback and encrypted refresh-token rotation are implemented and unit-tested; real provider consent/accounts remain unverified.
- Authenticated staging/live verification: BLOCKED until a dedicated staging test account and provider client credentials are available, then each connection is tested, enabled, and approved.

A PASS in the mapping column means the exact trigger/action pair has a worker mapping. Test-file matches are evidence pointers, not proof of a successful live provider call. No provider is labelled live-verified by this report. Workspace approval checks run in the durable worker immediately before each live provider handler; absent, revoked, or unreadable decisions fail closed.

## Provider-by-provider status

| Catalogue provider | Registry node | Operations | Worker mapping | Mock¶»§q«^