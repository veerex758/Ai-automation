# Phase 12 — staging end-to-end verification

Phase 12 verifies the deployed application through its public HTTP boundary. It does not treat a successful build or a READY deployment as proof of authenticated workflow behavior.

## Automated unauthenticated smoke test

Run against a dedicated staging or Vercel preview deployment only:

```sh
AIVANTA_STAGING_URL=https://<staging-or-preview-host> npm run staging:smoke
```

The script intentionally refuses the known production aliases and requires a hostname that identifies itself as staging, preview, or a Vercel Git preview. It sends no credentials, does not create data, does not invoke an authorized scheduler tick, and does not enable live execution.

Expected checks:
- `GET /api/health` returns HTTP 200 with JSON `status: "ok"`.
- `GET /api/workflows/actions` returns HTTP 401 while unauthenticated.
- `POST /api/ai/generate-workflow` returns HTTP 401 while unauthenticated.
- `POST /api/internal/scheduler` returns HTTP 401 when a scheduler secret is configured or HTTP 503 when scheduler authentication is not configured.

A Vercel deployment-protection login/redirect is not counted as an application-level pass; use the authorized browser session to reach the preview and record that check separately. Do not weaken deployment protection to make the smoke test pass.

## Authenticated browser acceptance matrix

Use an authorized staging test account and record pass/fail, UTC timestamp, deployment commit, and sanitized evidence. Never record credentials, access tokens, prompts, email addresses, or workflow payloads.

| Area | Test | Expected result |
| --- | --- | --- |
| Authentication | Open dashboard signed out | Redirect to sign-in or protected view; no private workspace data |
| Authentication | Sign in with staging account | Dashboard and builder load |
| Workspace isolation | Request another workspace's known resource using the staging account | Denied without disclosing its data |
| Action catalog | Load the action picker while signed in | Catalog loads; default execution policy is dry-run |
| Action catalog | Request catalog while signed out | HTTP 401 from the application endpoint |
| Builder validation | Leave required action fields blank | Review/apply is blocked with actionable validation |
| Builder validation | Enter malformed email or non-HTTPS webhook URL | Validation rejects it |
| AI drafting | Submit a bounded workflow description | Draft is previewed for review; not auto-saved or executed |
| Scheduler security | Call scheduler without its secret | HTTP 401 or safe HTTP 503; no schedule processing |
| Run history | Execute a dry-run fixture | Run and step outcomes persist and remain workspace-scoped |
| Side-effect safety | Inspect staging execution policy and logs | No email, Slack, webhook, or other external side effect during these tests |

## Release gates and ownership

- Phase 11 observability/security work must be reviewed and merged independently; Phase 12 does not imply Phase 11 is complete.
- Run the smoke script only against an isolated staging/preview host.
- Authenticated checks require an authorized staging identity and a browser session. Automated unauthenticated smoke tests do not replace them.
- Real email delivery is a separate explicitly approved test using a verified sender and an owner-controlled inbox. It is not part of this smoke script.
- Do not enable live workflow execution or scheduled side effects to make a test pass.
- Record any unavailable environment/configuration as blocked, not passed.
