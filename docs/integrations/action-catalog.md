# Reusable workflow action catalog

Phase 10 starts by defining a single, server-owned catalog of supported workflow action types. The authenticated endpoint is `GET /api/workflows/actions`.

## Catalog entries

| Provider | Operation | Execution status | Notes |
| --- | --- | --- | --- |
| `internal` | `create_task` | Dry-run only | No external task is created. |
| `email` | `send_email` | Guarded live path exists | Resend requires server credentials, a verified sender, an allowlisted recipient, and the explicit live-execution flag. |
| `slack` | `send_message` | Dry-run only | Slack credentials and a live adapter are not connected. |
| `webhook` | `http_request` | Dry-run only | HTTPS URL validation exists; dry runs never contact the URL. |

The catalog provides UI-friendly labels, field metadata, category, execution status, and explicit requirements. It contains no credentials and is returned only to authenticated users with private/no-store cache headers.

## Safety boundaries

- A catalog entry is not proof that a provider is connected or ready for production.
- Dry-run remains the default execution mode and must not perform network calls.
- Do not add secrets to workflow definitions or return provider credentials to the browser.
- Any future live connector must validate its input and authorization server-side, use least-privilege credentials, bound timeouts and retries, handle rate limits safely, and record sanitized outcomes.
- Live execution remains disabled unless the server configuration explicitly enables it. Do not enable it as part of catalog work.

## Verification

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`. Catalog tests verify supported action pairs, declared execution status, absence of credential fields, and defensive copies.
