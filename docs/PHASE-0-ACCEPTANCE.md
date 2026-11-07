# Phase 0 — Foundation acceptance and closure checklist

This checklist is the final acceptance record for the current foundation/Preview milestone. It is deliberately separate from feature-roadmap completion: passing CI or receiving a READY deployment does not prove that a signed-in user can safely use the system.

## Safety boundary

- Use the dedicated non-production Supabase project and a protected Vercel Preview deployment only.
- Do not use Production users, data, credentials, OAuth clients, or provider connections.
- Do not change Production environment variables, Auth settings, database schema, or deployment aliases as part of this gate.
- Do not send real email, Slack messages, webhooks, or other provider actions. Draft/save and dry-run checks must have no external side effects.
- Never put passwords, cookies, OAuth state/code, access or refresh tokens, client secrets, encryption keys, or private workflow payloads in logs or evidence.
- Do not weaken Vercel deployment protection to make automated checks pass.

## Code and CI gates

Record the exact commit SHA and CI run for each code gate.

- [ ] Current PR diff reviewed; no unintended files or secrets.
- [ ] Workflow/node validation tests pass.
- [ ] Google OAuth state, callback-host, cookie-clearing, and diagnostic regression tests pass.
- [ ] Unauthenticated workflow catalog, AI generation, workflow validation, scheduler, and Google connections endpoints reject access with the expected application response.
- [ ] Lint passes.
- [ ] Type-check passes.
- [ ] Production build passes.
- [ ] Existing migration replay/schema/RLS evidence is still applicable to this code revision; no unreviewed migration is introduced.
- [ ] Preview configuration is complete and branch-scoped: Supabase Preview URL/keys, Google OAuth client ID/secret, exact callback URI, and server-side credential-encryption configuration.
- [ ] No Production environment or database configuration was changed.

## Protected Preview acceptance

Run these checks in the browser against the newly deployed exact commit. Record UTC time, commit SHA, deployment ID/URL, result, and sanitized evidence.

| Gate | Test | Pass condition |
| --- | --- | --- |
| Preview protection | Open the Preview URL while signed out. | Vercel protection behaves as configured; protection redirects are recorded as BLOCKED, never mistaken for application success. |
| Authentication | Sign in with an authorized test account, refresh, navigate dashboard/builder, then sign out. | Session persists only while valid; signed-out API requests expose no private data; invalid credentials show a safe actionable error. |
| Workspace isolation | Use two authorized staging identities/workspaces and attempt cross-workspace reads and mutations. | Requests are denied and the other workspace's data is neither disclosed nor changed. |
| Connections API | Open Connections while authenticated and inspect the network response. | Only the current actor's workspace connection metadata is returned; no token or secret fields are present. |
| Google OAuth start | Start Gmail and Sheets authorization from the exact Preview branch URL. | Google receives the exact registered callback URI and read-only scopes; state/PKCE cookies are HttpOnly, short-lived, and host-aligned. |
| Google OAuth callback | Test successful consent and a cancelled/invalid-state response using approved test accounts. | State and PKCE are validated; failures are classified safely; credentials are encrypted server-side; no token/code/secret is returned to the browser or logs. |
| Connection persistence | Reload Connections after a successful authorization. | The connection appears as metadata for the correct actor/workspace and remains after reload. |
| Workflow draft | Create/edit/save a draft, reload it, and inspect the restored definition. | Draft data persists; saving or applying a generated draft does not execute it. |
| AI draft review | Generate a bounded workflow draft and inspect before applying. | The result is reviewable and validated; missing configuration/errors are clear; generation does not auto-save or execute. |
| Dry-run | Execute only a safe staging fixture and inspect run/step history. | Run and step records persist in the correct workspace; no provider side effect occurs. |
| Scheduler safety | Check unauthenticated rejection and approved staging-only dry-run behaviour if configured. | Missing/invalid credentials fail closed; no live scheduled execution or provider side effect occurs. |

## Evidence record

Use one line per gate:

`[GREEN|YELLOW|RED|BLOCKED] Gate — environment — commit SHA — deployment ID/URL — UTC timestamp — sanitized evidence — next action`

- **GREEN:** the exact test was run and the expected result was observed.
- **YELLOW:** implementation or partial evidence exists, but the full test has not passed.
- **BLOCKED:** access, credentials, deployment protection, or an operator action prevents a safe test.
- **RED:** the test ran and a confirmed failure occurred.

Do not mark Phase 0 closed until all code/CI gates and all required Preview acceptance gates are GREEN. A protected-preview redirect, an unrun browser test, or a test performed on a different commit is not a pass.

## Rollback

This checklist adds no runtime behaviour, schema, or environment changes. Revert the checklist commit if it is no longer applicable. For code changes, use the owning PR's documented rollback. Do not roll back or modify Production as part of Preview acceptance.
