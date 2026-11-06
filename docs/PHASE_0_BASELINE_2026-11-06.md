# Phase 0 baseline — 2026-11-06

## Scope
Read-only baseline verification for PR #137 and PR #138. No production settings, database schema/data, credentials, or live provider actions were changed. No Vercel deployment was initiated by this baseline review.

## Pull requests and CI
- PR #137: `feat/ai-first-workflow-experience` → `main`; head `cf0ab2ece178c86a494cf161b620b5b2d3d916f1`; open draft; GitHub reports mergeable.
- PR #137 CI run `42146780466`: passed. The `verify` job completed workflow validation tests, lint, type-check, and build.
- PR #137 Vercel status check: success.
- PR #138: `fix/connections-load-diagnostics` → `feat/ai-first-workflow-experience`; head `c43e56a85218b94fe0be5f950f364cc1eabf5c26`; open draft; GitHub reports mergeable.
- PR #138 CI run `42147986485`: passed. The `verify` job completed workflow validation tests, lint, type-check, and build.
- PR #138 Vercel status check: success.
- PR #138 is intentionally stacked on PR #137. Merge #137 first, then retarget/rebase #138 onto main and rerun CI. Do not merge #138 directly to main while its base is the feature branch.

## Connections failure investigation

### Verified facts
1. The Connections page calls `GET /api/integrations/google/connections`; before PR #138, it displayed only a generic API error.
2. The API requires an authenticated Supabase user, resolves the default workspace through `get_or_create_default_workspace`, requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then queries `public.google_connections` using the service-role client scoped by workspace ID and connected user ID.
3. Staging project `aivanta-staging` (`ygclofqxtztnynkljipj`) has the `google_connections` table. Migration `20261021235009_google_oauth_connections` is recorded as applied.
4. Staging grants match the intended server-only design: service_role has SELECT; authenticated and anon do not. The table currently has zero rows; that is not evidence of a failed migration.
5. The Vercel project has a Preview-targeted `SUPABASE_SERVICE_ROLE_KEY` environment-variable entry. Its secret value was not decrypted or inspected.
6. Vercel Hobby runtime logs do not retain the historical window needed to reconstruct the earlier report. A current 50-minute preview log query and the available seven-day runtime-error query returned no matching events.

### Root-cause conclusion
The exact historical runtime exception is **not yet proven**. A missing `google_connections` table or missing table migration is ruled out for the inspected staging project.

The original API route collapsed multiple failure paths into one generic response: workspace-resolution/RPC failure, missing server environment configuration (returned as HTTP 503 by the route), or a service-role query failure. Retained logs do not distinguish which occurred during the user's recording. An environment-variable entry does not prove its value is valid; secret values were deliberately not read.

PR #138 adds safe diagnostic categories and server-side context:
- `CONNECTION_STORAGE_NOT_CONFIGURED`
- `CONNECTION_QUERY_FAILED`
- `CONNECTIONS_UNAVAILABLE`

To close the exact cause, reproduce the authenticated request against the PR #138 preview and inspect its diagnostic code/server log. No authenticated user session was available to perform that final reproduction in this review.

## Workflow API baseline
- `POST /api/ai/generate-workflow`: authenticated AI draft generation using the public registered-node catalog; safety/validation failures are mapped to HTTP responses.
- `POST /api/workflows/[workflowId]/definition`: validates a submitted workflow definition; the PATCH save path is used by the AI Assistant to persist the draft.
- `POST /api/workflows/[workflowId]/registry-run`: authenticated registry runner with run-history persistence, idempotency on live runs, and a server-side live-execution gate.
- `POST /api/workflows/[workflowId]/live-run`: legacy live-run route; delegates to the registry runner only when `x-aivanta-runner: registry` is supplied.
- `GET /api/integrations/google/connections`: authenticated, workspace- and actor-scoped metadata list; tokens are not selected for browser output.

Execution distinction:
- Registry dry-run validates operation existence and input schemas and reports simulated steps; it does not call provider code or make network requests.
- Non-dry-run registry execution invokes registered provider operations using the current server context. This is not yet a provider-mocked sandbox with workspace credential resolution.
- `nodes/registry.ts` currently registers manual, webhook, OpenAI, Slack, and email nodes—not the full 73-node catalogue.
- The visual builder and AI-generated draft UX are not yet a complete connected graph editor with full execution visualization.

## Known gaps / next gates
1. Reproduce the authenticated Connections request on PR #138 preview and capture its diagnostic code; then verify list, OAuth callback persistence, and workspace isolation.
2. Confirm Preview Google OAuth client and encryption-key values without exposing secrets; use staging-only credentials and callback.
3. After #137 merges, rebase/retarget #138 onto main and rerun CI on the combined main-based diff.
4. Build a real sandbox adapter layer and workspace-scoped credentials before describing registry execution as a safe sandbox.
5. Build the actual node graph editor and map AI output into graph edges and registered operations.
6. Complete authenticated staging end-to-end tests; CI alone does not prove OAuth, database writes, or provider behavior.

## Safety / deployment note
No migration was applied, no Vercel deployment was triggered by this baseline review, no secret value was read, and no real provider action was executed.
