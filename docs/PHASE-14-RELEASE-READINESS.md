# Phase 14 — Release readiness and staging-only exit criteria

This phase consolidates the release handoff. It does **not** declare Aivanta launch-ready by itself: code/CI evidence and operator acceptance are tracked separately. The target is to finish implementation and safe automated verification first, leaving only the explicitly listed staging/operator checks.

## Non-negotiable safety boundary

- Use a dedicated staging project and protected non-production preview only.
- Do not point staging at production data or credentials.
- Do not weaken Vercel deployment protection to make an automated check pass.
- Keep scheduler processing dry-run only; do not send real email, Slack, webhook, or other provider actions.
- Do not copy secrets, prompts, workflow payloads, email addresses, access tokens, or authorization headers into logs or evidence.
- Do not reset the staging database, rewrite migration history, or change production configuration as part of acceptance.
- A successful build, CI run, migration replay, or READY deployment is not authenticated end-to-end acceptance.

## Code-side completion gates (must be closed before the staging handoff)

- [ ] Every in-scope PR has a reviewed diff and passing CI on its exact current head.
- [ ] Workflow validation, lint, type-check, and production build pass for the current implementation.
- [ ] Supabase migrations replay cleanly in an isolated local database; the recorded staging schema/RLS/grant evidence remains valid for the schema commit under test.
- [ ] Authentication is checked server-side; protected API routes reject unauthenticated requests before reading sensitive request bodies.
- [ ] Workspace-scoped queries and mutation paths include authorization/ownership constraints; no user-editable metadata is trusted for authorization.
- [ ] Error responses are sanitized and private/no-store where user or workspace data may be involved.
- [ ] Operational logs are allow-listed and exclude user content, credentials, provider payloads, and secrets.
- [ ] Scheduler failure paths fail closed; dry-run remains the default and no provider side effects are enabled by the staging smoke test.
- [ ] Smoke-test target validation accepts only the approved project-owned HTTPS preview hostname pattern and rejects production aliases and arbitrary domains.
- [ ] Documentation identifies operator-only steps without claiming they have already passed.

Record a gate as GREEN only with the exact commit, CI run or test evidence, and timestamp. If a code gate fails, fix it and re-verify the changed commit before moving on. Do not use a deployment from a different SHA as evidence for the current head.

## Final staging acceptance — operator/browser work only

Run this section once a protected preview is available for the exact accepted code revision and an authorized operator has access. Record UTC timestamp, commit SHA, deployment ID/URL, result, and sanitized evidence. Never include credentials or private payloads.

| Gate | Procedure | Pass condition |
| --- | --- | --- |
| Protected-preview smoke | Run the guarded staging smoke script against the approved non-production preview. | All expected health/auth/validation/scheduler responses come from the application; a Vercel login/redirect is recorded as blocked, not passed. |
| Authentication | Sign in with an authorized staging test account and open the dashboard/builder. | Session is validated server-side; signed-out requests expose no private workspace data. |
| Builder draft persistence | Save a named builder draft, reload, restore it, and switch between saved drafts. | Valid steps and names restore; malformed local data does not crash the builder; no workflow is executed by saving/restoring. |
| AI draft review | Request a bounded AI draft and inspect it before applying. | Draft is validated and shown for review; generation does not auto-save or execute it. |
| Action validation | Try missing required fields, malformed email, and non-HTTPS webhook values. | Invalid configuration is blocked with an actionable message before execution. |
| Run history | Run a safe dry-run fixture and inspect run/step metadata. | History is persisted and visible only within the correct workspace; no provider side effect occurs. |
| Workspace isolation | With two authorized staging test identities, attempt cross-workspace reads and mutations. | Access is denied without revealing or changing the other workspace's data. |
| Scheduler | Verify unauthenticated rejection, then perform only an approved staging-only authenticated dry-run if configured. | Missing/invalid credentials fail closed; no live workflow/provider side effect occurs. |
| Auth configuration | Authorized operator reviews leaked-password protection, redirect allow-list, and session settings in the staging project. | Findings and any approved changes are recorded; production Auth settings remain untouched. |
| Recovery | Authorized operator verifies backup retention and performs a non-production restore/recovery drill. | Recovery outcome and restore point are recorded without touching production data. |
| Monitoring | Confirm alert/log access, retention, and an accountable operational owner. | Ownership and retention are documented; request IDs can be used without logging sensitive payloads. |

A real email delivery test is **not** part of this checklist. It requires a separate explicit approval, verified sender, owner-controlled inbox, isolated credentials, and a recorded rollback/cleanup plan.

## Evidence record template

`[GREEN|YELLOW|RED|BLOCKED] Gate — staging environment — commit/deployment — UTC timestamp — sanitized evidence — next action`

- **GREEN:** the exact gate was executed and its expected result was observed.
- **YELLOW:** code or evidence exists, but a required acceptance sub-step is incomplete.
- **BLOCKED:** the test cannot safely run because access, preview capacity, credentials, or operator action is unavailable.
- **RED:** the gate ran and produced a confirmed failure.

Do not mark the overall release GREEN until all code-side gates and all required staging/operator gates have their own valid evidence. Keep unresolved operator work explicitly BLOCKED and do not use it as a reason to stop unrelated safe code work.
