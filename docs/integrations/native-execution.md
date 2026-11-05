# Native integration execution

The native registry exposes ten vendor integrations through Aivanta-owned schemas and adapters. The durable worker resolves credentials from the current workspace only, executes registered operations, and writes sanitized step checkpoints to the existing workflow run history.

| Integration | Operation | Permission profile |
| --- | --- | --- |
| Gmail | List messages | Google Gmail read-only OAuth scope |
| Google Sheets | Read cell values | Google Sheets read-only OAuth scope |
| Slack | Post channel message | Bot token with chat:write |
| Notion | Create database page | Integration access to selected database |
| HubSpot | Create contact | CRM contacts write scope |
| Twilio | Send SMS | Account messaging permission and recipient allowlist |
| Shopify | List products | Admin API products read scope |
| Stripe | Create customer | Customers write; does not create a charge |
| Resend | Send email | Existing sender and recipient allowlist |
| Linear | Create issue | Issue write permission in selected team |

## Execution boundaries

- Dry-run validates registered schemas and never calls a provider.
- Live jobs still require the global `AIVANTA_LIVE_EXECUTION_ENABLED=true` switch.
- New providers (Gmail, Sheets, Notion, HubSpot, Twilio, Shopify, Stripe, Linear, and Slack bot-token messaging) additionally require their lowercase provider key in `AIVANTA_LIVE_INTEGRATIONS`.
- The 20 additional provider-pack adapters (Claude, Mistral, Groq, Perplexity, Discord, Telegram, WhatsApp Business, SendGrid, Mailgun, Postmark, GitHub, GitLab, Sentry, Vercel, Calendly, Zendesk, Freshdesk, SerpAPI, OpenWeather, and RSS Feed) are mapped into the durable worker. Each requires its exact lowercase node ID in `AIVANTA_LIVE_INTEGRATIONS`; the global live-execution switch is still mandatory.
- Provider-pack live actions resolve only the matching workspace credential record before execution. RSS Feed is credential-free but remains explicitly gated as `rss_feed`.
- The 20 adapters have provider-specific mocked contract tests for endpoint/response handling, credential failures, rate limits, and exact opt-in gates. These tests do not claim that real external accounts or credentials have been live-tested.
- Live durable jobs retain the queue's single-attempt rule. Provider actions are not automatically retried after an uncertain outcome; do not treat this as exactly-once delivery for providers that do not offer idempotency keys.
- Twilio recipients must also be literal E.164 values in `AIVANTA_LIVE_SMS_RECIPIENTS`.
- Email recipients remain protected by `AIVANTA_LIVE_EMAIL_RECIPIENTS`.
- No live integration is enabled by this code change. Environment flags must be reviewed and configured separately.
- Google access and refresh tokens remain in the existing server-only `google_connections` store. The worker refreshes expired access tokens server-side and re-encrypts the updated token envelope.
- All other provider secrets use the existing AES-256-GCM workspace credential envelope and associated data binding.
- Provider errors are reduced to stable codes; authorization headers and response bodies are not logged.

## Database

Migration `20261103050000_aivanta_integration_provider_allowlist.sql` expands the workspace provider constraint and the service-role-only credential save RPC. It is reversible by restoring the previous provider constraint and RPC allowlist. It has not been applied to any database.
