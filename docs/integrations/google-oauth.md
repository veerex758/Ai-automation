# Google OAuth connections

This feature adds the first official account-authorization flow for Gmail and Google Sheets. The initial permissions are read-only. Connecting an account does not execute workflows, send mail, or modify spreadsheets.

## Required environment variables

Configure these only in the deployment's server-side secret store; never use a `NEXT_PUBLIC_` prefix for secrets:

- `GOOGLE_CLIENT_ID`: OAuth client ID from the Google Cloud project.
- `GOOGLE_CLIENT_SECRET`: OAuth client secret.
- `GOOGLE_REDIRECT_URI`: exact registered callback URL ending in `/api/integrations/google/callback`.
- `GOOGLE_TOKEN_ENCRYPTION_KEY`: base64-encoded 32-byte key used for AES-256-GCM credential encryption. Generate a fresh key for each environment and do not commit it.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase service role key required for private connection storage. Never expose it to the browser.

Use separate Google OAuth clients and encryption keys for local development, preview/staging, and production. Do not enable production until staging acceptance and Google OAuth consent-screen requirements are complete.

## Google Cloud setup

1. Create or select a Google Cloud project controlled by the Aivanta owner.
2. Configure the OAuth consent screen, audience, and support/contact details.
3. Enable the Gmail API and Google Sheets API.
4. Create a Web application OAuth client.
5. Add the exact value of `GOOGLE_REDIRECT_URI` to Authorized redirect URIs.
6. Add only approved staging test accounts to the test audience while the app is in testing.
7. Keep the client secret in the server-side environment only.

## Routes

- `GET /api/integrations/google/start?product=gmail`
- `GET /api/integrations/google/start?product=sheets`
- `GET /api/integrations/google/callback`
- `GET /api/integrations/google/connections`

The start route requires a signed-in Aivanta user, uses a short-lived HttpOnly state cookie and PKCE verifier, and asks Google for product-specific read-only scope. The callback validates state, exchanges the code server-side, confirms the verified Google account email, encrypts the credential payload using AES-256-GCM, and writes it through a server-only service-role client. The status endpoint returns metadata only and filters to the user's resolved workspace and user ID.

The database migration creates `public.google_connections` with RLS enabled and no table privileges for `anon` or `authenticated`. Only the service role may access the table. Keep service-role access in server code and scope all queries by workspace and actor.

## Before enabling in staging

- Apply the new migration to the dedicated staging database using the repository's reviewed migration process. Do not reset the database or rewrite migration history.
- Set the five environment variables in the staging/preview environment only, using a dedicated OAuth client and a newly generated key.
- Confirm the callback URL exactly matches the Google Cloud client.
- Run lint, type-check, tests, and production build on the exact PR head.
- Test cancelled consent, invalid state, missing configuration, token exchange failure, verified account identity, encrypted storage, status response redaction, and workspace isolation.
- Inspect browser network responses and server logs to confirm no access/refresh tokens, authorization codes, client secrets, or encryption keys are exposed.
- Do not enable Gmail write/send or Sheets write scopes until a separately reviewed permission and execution change is approved.
