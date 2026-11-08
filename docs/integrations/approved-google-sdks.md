# Approved integration SDKs

Aivanta uses vendor-maintained API clients behind its own node definitions, schemas, credential vault, and runner. It does not load n8n community node source code or execute arbitrary npm package code as workflow nodes.

## Pinned packages

| Integration | Package | Exact version | License |
| --- | --- | --- | --- |
| Gmail | `@googleapis/gmail` | `22.0.2` | Apache-2.0 |
| Google Sheets | `@googleapis/sheets` | `18.1.2` | Apache-2.0 |
| Slack | `@slack/web-api` | `8.2.0` | MIT |
| Notion | `@notionhq/client` | `5.28.0` | MIT |
| HubSpot | `@hubspot/api-client` | `14.0.1` | MIT |
| Twilio | `twilio` | `6.2.0` | MIT |
| Shopify | `@shopify/shopify-api` | `15.0.1` | MIT |
| Stripe | `stripe` | `23.0.1` | MIT |
| Resend | `resend` | `6.37.0` | MIT |
| Linear | `@linear/sdk` | `100.0.0` | MIT |

These versions are exact pins, not floating semver ranges. Package ownership, package identity, and published version metadata were checked against their npm package pages and vendor repositories/documentation. CI must still complete dependency installation, tests, lint, type-check, and build before this change is eligible for merge; a clean install is not a substitute for a full transitive vulnerability review.

## Security and runtime boundary

- No n8n runtime or `n8n-nodes-*` package is added.
- SDKs are server-side integration libraries; do not import credential-bearing clients into browser components.
- Secrets and OAuth tokens must be read from the workspace credential vault at execution time and must never be logged or returned to clients.
- Each integration still requires a reviewed native Aivanta adapter, input/output schemas, least-privilege OAuth scopes or API permissions, token refresh/revocation handling, and mocked tests before it is exposed as an executable node.
- Adding an SDK does not connect an account, grant permissions, or execute an API call.
- Dropbox is deliberately not included in this batch: the current Dropbox SDK release requires Node.js 22+, while this repository's CI currently runs Node.js 20. We should upgrade and validate the runtime separately before adding it.

## Rollout

This change only updates the dependency manifest and its package-pin regression test. No credentials, OAuth registrations, database migrations, staging settings, production settings, or Vercel deployments are changed.
