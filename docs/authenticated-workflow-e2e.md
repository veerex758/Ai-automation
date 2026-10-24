# Authenticated workflow lifecycle E2E

This Playwright suite runs only against an explicitly configured, non-production HTTPS preview. It signs in with a dedicated test account, creates one uniquely named workflow, saves and reloads its definition, sets its persisted status to active through the authenticated API, and deletes only that test-created workflow during cleanup.

## Configure GitHub Actions

Use a dedicated staging Supabase user/workspace, not a personal or production account.

- Repository **variable** `AIVANTA_E2E_BASE_URL`: the approved HTTPS Vercel preview/staging URL. It must be a preview hostname containing `-git-`, `preview`, or `staging`; the known production alias is rejected by the test.
- Repository **secret** `AIVANTA_E2E_EMAIL`: email address of the dedicated staging test account.
- Repository **secret** `AIVANTA_E2E_PASSWORD`: password for that test account.

Do not add these credentials to Vercel environment variables, `.env.example`, source code, or PR comments. The opt-in E2E job runs only when `AIVANTA_E2E_BASE_URL` is configured. If the URL is configured but credentials are missing, the job fails rather than silently skipping.

## Run locally

Set the same variables in a secure local shell, then run:

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

The test intentionally refuses HTTP targets, the production alias, and hosts that do not clearly identify a preview/staging deployment. It does not send email, call Slack, or send webhooks.

## Honest limitation

The current builder UI supports persistent definition saving and reload. It does **not** yet expose an Activate button or create/update the schedule configuration required for automatic scheduled execution. The test therefore verifies that the authenticated API persists the workflow's `active` status, but does not claim the workflow will run automatically. A later workflow-activation/scheduling implementation must add user-facing activation, schedule configuration, and a real dry-run history assertion before activation can be considered complete.

The test is unverified until it runs with the dedicated staging account and the preview deployment. Never use a production account or production hostname.
