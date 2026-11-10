# Workspace-isolation verification

## Scope of automated checks

The code-side test `tests/workspace-isolation-policy-contract.test.mjs` checks that the tracked workspace/workflow, run-history, and schedule migrations retain key isolation safeguards:

- Row-level security is enabled on the relevant tables.
- Reads and writes are constrained by workspace membership and authenticated actor identity.
- Run-history rows are tied to the same workspace as their parent workflow/run.
- Schedule rows are tied to the same workspace as their workflow.
- Authenticated clients can update only schedule configuration columns; worker lease fields remain server-owned.
- Scheduler claim/renew/finalize RPCs are restricted to `service_role`.

These are migration-source regression checks. **They do not prove runtime RLS behavior** and are not a substitute for isolated-database tests or authenticated staging acceptance.

## Deferred runtime acceptance (do not run while live testing is paused)

When explicitly authorized to resume testing, use two dedicated non-production identities in separate workspaces (A and B). Never use production identities or record passwords, cookies, bearer tokens, or raw authorization headers.

1. Create one disposable workflow, version, run-history record, and schedule in workspace A.
2. Confirm identity B cannot list, read, update, delete, or infer those records through the UI or authenticated APIs.
3. Attempt cross-workspace parent references (for example, a run step in B pointing at a run in A); expect rejection.
4. Confirm identity A retains access to its own records after switching sessions and reloading.
5. Confirm authenticated clients cannot mutate schedule lease fields or invoke privileged scheduler RPCs.
6. Record sanitized status, exact commit, environment/deployment, and evidence in the shared verification ledger (issue #34). Delete only disposable fixtures created by the test, using narrow IDs.

## Safety gates

- Do not reset or mutate the remote Supabase database as part of code-side work.
- Do not weaken preview protection or bypass authentication to make a test pass.
- Do not enable live execution or send email, Slack, or webhook actions.
- Keep runtime checks deferred until the user explicitly asks to resume live testing.
