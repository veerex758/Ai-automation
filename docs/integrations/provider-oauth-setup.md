# Provider OAuth setup

The generic OAuth routes are:

- Start: `/api/integrations/oauth/{provider}/start`
- Callback: `/api/integrations/oauth/{provider}/callback`

Register the exact callback URL for the Aivanta deployment origin in each provider developer console. The callback origin must match the origin used to begin authorization.

## Required server configuration

- `AIVANTA_OAUTH_STATE_SECRET`: at least 32 bytes of high-entropy random data. It signs short-lived, provider-bound OAuth state.
- `AIVANTA_CREDENTIALS_ENCRYPTION_KEY`: the existing 32-byte base64 credential encryption key.
- Provider-specific client ID and client secret environment variables listed below.

Provider client secrets remain server-side. OAuth access tokens, refresh tokens, expiry and scope metadata are encrypted with workspace/provider associated data before being stored. The browser receives neither tokens nor client secrets.

| Provider | Client ID | Client secret |
|---|---|---|
| Microsoft Teams | `AIVANTA_MICROSOFT_TEAMS_CLIENT_ID` | `AIVANTA_MICROSOFT_TEAMS_CLIENT_SECRET` |
| Salesforce | `AIVANTA_SALESFORCE_CLIENT_ID` | `AIVANTA_SALESFORCE_CLIENT_SECRET` |
| Pipedrive | `AIVANTA_PIPEDRIVE_CLIENT_ID` | `AIVANTA_PIPEDRIVE_CLIENT_SECRET` |
| Zoho CRM | `AIVANTA_ZOHO_CRM_CLIENT_ID` | `AIVANTA_ZOHO_CRM_CLIENT_SECRET` |
| Intercom | `AIVANTA_INTERCOM_CLIENT_ID` | `AIVANTA_INTERCOM_CLIENT_SECRET` |
| Asana | `AIVANTA_ASANA_CLIENT_ID` | `AIVANTA_ASANA_CLIENT_SECRET` |
| Todoist | `AIVANTA_TODOIST_CLIENT_ID` | `AIVANTA_TODOIST_CLIENT_SECRET` |
| Bitbucket | `AIVANTA_BITBUCKET_CLIENT_ID` | `AIVANTA_BITBUCKET_CLIENT_SECRET` |
| X | `AIVANTA_X_TWITTER_CLIENT_ID` | `AIVANTA_X_TWITTER_CLIENT_SECRET` |
| LinkedIn | `AIVANTA_LINKEDIN_CLIENT_ID` | `AIVANTA_LINKEDIN_CLIENT_SECRET` |
| Facebook Pages | `AIVANTA_FACEBOOK_PAGES_CLIENT_ID` | `AIVANTA_FACEBOOK_PAGES_CLIENT_SECRET` |
| Instagram | `AIVANTA_INSTAGRAM_CLIENT_ID` | `AIVANTA_INSTAGRAM_CLIENT_SECRET` |
| TikTok | `AIVANTA_TIKTOK_CLIENT_ID` | `AIVANTA_TIKTOK_CLIENT_SECRET` |
| Dropbox | `AIVANTA_DROPBOX_CLIENT_ID` | `AIVANTA_DROPBOX_CLIENT_SECRET` |

## Security and release behavior

- OAuth state is signed, expires after ten minutes, and is bound to provider, workspace and authenticated user.
- PKCE S256 is enabled for providers that support it.
- Callback state must match both the signed state and the HTTP-only callback cookie.
- Refresh tokens are encrypted and rotated server-side when an expiring access token is needed.
- Meta page and Instagram business-account discovery stores the selected page token/account ID without exposing them to the browser.
- Newly connected credentials remain `needs_attention` until a read-only provider connection test passes.
- A connected account does not itself authorize live workflow actions. A workspace owner/admin must approve the registered operation, and the server-side live-provider gates must also be enabled.
- Do not perform provider consent or live refresh tests against production accounts until dedicated staging credentials and callback URLs are configured.
