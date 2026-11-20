# Google OAuth connections

This feature provides official account authorization for Gmail, Google Sheets, Drive, Calendar, Docs, Forms, YouTube and Contacts. Each connection requests only its product-specific read-only scope. Connecting an account does not execute workflows or modify provider data.

## Required environment variables

Configure these only in the deployment's server-side secret store; never use a `NEXT_PUBLIC_` prefix for secrets:

- `GOOGLE_CLIENT_ID`: OAuth client ID from the Google Cloud project.
- `GOOGLE_CLIENT_SECRET`: OAuth client secret.
- `GOOGLE_REDIRECT_URI`: exact registered callback URL ending in `/api/integrations/google/callback`.
- `GOOGLE_TOKEN_ENCRYPTION_KEY`: base64-encoded 32-byte key used for AES-256-GCM credential encryption. Generate a fresh key for each environment and do not commit it.
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase secret/service role key required for private connection storage. Never expose it to the browser.

Use separate Google OAuth clients and encryption keys for local development, preview/staging, and production. Do not enable production until staging acceptance and Google OAuth consent-screen requirements are complete.

## Google Cloud setup

1. Create or select a Google Cloud project controlled by the Aivanta owner.
2. Configure the OAuth consent screen, audience, and support/contact details.
3. Enable the Gmail, Google Sheets, Google Drive, Google Calendar, Google Docs, Google Forms, YouTube Data and People APIs.
4. Create a Web application OAuth client.
5. Add the exact value of `GOOGLE_REDIRECT_URI` to Authorized redirect URIs.
6. Add only approved staging test accounts to the test audience while the app is in testing.
7. Keep the client secret in the server-side environment only.

## Routes

- `GET /api/integrations/google/start?product=gmail`
- `GET /api/integrations/google/start?product=sheets`
- `GET /api/integrations/google/start?product=drive`
- `GET /api/integrations/google/start?product=calendar`
- `GET /api/integrations/google/start?product=docs`
- `GET /api/integrations/google/start?product=forms`
- `GET /api/integrations/google/start?product=youtube`
- `GET /api/integrations/google/start?product=contacts`
- `GET /api/integrations/google/callback`
- `GET /api/integrations/google/connections`

The start route requires a signed-in workspace owner/admin, maps the selected node to its Google product, prompts for account selection and consent, uses a short-lived HttpOnly state cookie and PKCE verifier, and asks Google for the product-specific read-only scope. The callback repeats the workspace permission check, validates state, exchanges the code server-side, confirms the verified Google account email, encrypts the credential payload using AES-256-GCM, and writes a separate account record through a server-only service client. Multiple Google accounts are supported for the same product.

The connection list returns metadata only and is workspace-scoped. A POST to the same route tests one selected account: it confirms the required read-only scope and verified Google identity, refreshes an expired access token when possible, and records a passed/failed state. This is a Google identity and consent-scope check, not a claim that every downstream Gmail/Sheets/Drive API operation has been exercised. A DELETE disconnects one selected account from the workspace and attempts Google token revocation; the response separately reports whether Google accepted remote revocation. Reconnect always uses the product-specific OAuth route and a new account selection. The node configuration panel stores only the selected connection ID.

The database migration creates `public.google_connections` with RLS enabled and no table privileges for `anon` or `authenticated`. Only the service role may access the table. Every lookup, update, refresh and delete must be scoped to the resolved workspace and connection ID. Workspace admins may share a connection with other nodes in the same workspace; account ownership must not be confused with workspace ownership.

## Before enabling in staging

- Apply the new migration to the dedicated staging database using the repository's reviewed migration process. Do not reset the database or rewrite migration history.
- Set the five environment variables in the staging/preview environment only, using a dedicated OAuth client and a newly generated key.
- Confirm the callback URL exactly matches the Google Cloud client.
- Run lint, type-check, tests, and production build on the exact PR head.
- Test cancelled consent, invalid state, missing configuration, token exchange failure, verified account identity, encrypted storage, status response redaction, multiple accounts for one product, reconnect, token refresh, disconnect/revoke, and cross-workspace ID rejection.
- Inspect browser network responses and server logs to confirm no access/refresh tokens, authorization codes, client secrets, or encryption keys are exposed.
- Do not enable Gmail write/send or Sheets write scopes until a separately reviewed permission and execution change is approved.
