# Authenticated workflow lifecycle E2E

The optional Playwright suite verifies the authenticated draft lifecycle against an explicitly configured HTTPS staging/preview deployment.

## GitHub environment configuration

Configure these values in the protected `staging` environment:

- Variable `AIVANTA_E2E_BASE_URL`: exact HTTPS staging/preview URL. Production aliases are rejected by the test.
- Secret `AIVANTA_E2E_EMAIL`: dedicated staging test account.
- Secret `AIVANTA_E2E_PASSWORD`: dedicated staging test account password.

The workflow is manual-only and is skipped when no staging base URL is configured. Never use a production account or production URL.

## Covered lifecycle

1. Sign in through the real login form.
2. Create a workspace-scoped workflow draft.
3. Save registry-backed definition and reload it from the server.
4. Validate the definition.
5. Run a registry dry-run and assert that no provider side effects occurred.
6. Attempt activation of an unsupported one-step flow and verify the API rejects it.
7. Delete the temporary draft.

This suite deliberately does not activate workflows or send email, Slack, webhook, or other provider actions. Live activation remains governed by the server-side provider, recipient, successful-version dry-run and feature-flag gates.
