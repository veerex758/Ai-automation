# Official account authorization foundation

## Scope of this increment

Start with Google OAuth for Google Sheets using Google's official authorization and token endpoints. This is a provider-specific first connector, not a claim that arbitrary websites can be connected automatically. Gmail is a separate follow-up because it requires additional Gmail-specific scopes and a review of the actions Aivanta will expose.

## Non-negotiable security requirements

- Use Authorization Code flow with PKCE, a cryptographically random `state`, exact redirect URI matching, and short-lived, HttpOnly, Secure-in-production, SameSite=Lax cookies for the transient transaction.
- Construct authorization and token endpoints from a trusted, server-owned provider registry. Never accept OAuth endpoints, client IDs, redirect URIs, or scopes from the browser.
- Request only scopes needed by the chosen actions. For the initial Sheets connection, prefer `https://www.googleapis.com/auth/spreadsheets` and `https://www.googleapis.com/auth/drive.file` only if the product's file-creation/picker behavior actually needs it; do not silently request broad Drive or Gmail access.
- Keep client secrets, access tokens, and refresh tokens server-side. Encrypt stored tokens with authenticated encryption (AES-256-GCM) using a server-only key; never store plaintext tokens in workflow definitions, logs, AI prompts, or browser-visible responses.
- Store connection metadata separately from encrypted token material. Workspace members may see safe metadata, but browser clients must have no read permission on the secret table.
- Bind every connection to the authenticated user and an authorized workspace. Recheck membership and connection ownership before use, refresh, disconnect, or execution.
- Handle denial, expired codes, replayed state, missing refresh tokens, token revocation, and provider errors without returning raw provider payloads or secrets.
- OAuth consent only authorizes account access. It does not enable workflow execution. Actions remain dry-run unless the specific adapter is implemented, tested, and explicitly enabled.
- Disconnect should revoke tokens where supported and delete encrypted credentials. Record sanitized audit events only.

## Provider configuration

Server-only environment variables:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `AIVANTA_APP_URL` — canonical deployed origin, used to construct the exact callback URL
- `AIVANTA_CREDENTIAL_ENCRYPTION_KEY` — base64-encoded 32-byte random key, never a `NEXT_PUBLIC_*` variable

Register the exact callback URL `{AIVANTA_APP_URL}/api/connections/google/callback` in Google Cloud Console. Use separate OAuth clients for local development and staging/production. Never place real values in Git.

## Release gates

1. Review the OAuth implementation and migration as a single change.
2. Unit-test state mismatch, missing/expired transaction cookie, denied consent, invalid token response, and encryption/decryption failure.
3. Confirm RLS workspace isolation and confirm authenticated browser roles cannot select secret rows or columns.
4. Run lint, typecheck, all tests, and build on the exact PR head.
5. Verify the flow only in a protected staging preview with a dedicated test Google account. Do not connect a personal/production account during development.
6. Confirm logs and activity history contain no codes, tokens, client secrets, or credential ciphertext.
7. Keep live workflow actions disabled until adapter-level tests and separate acceptance are complete.

## Implementation status

Design contract only. OAuth is not yet connected, no account has been authorized, and no credentials have been stored. The current repository has no OAuth credential vault or Google OAuth environment configuration.
