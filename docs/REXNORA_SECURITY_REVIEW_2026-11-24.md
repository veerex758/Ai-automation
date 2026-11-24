# Rexnora security review — 2026-11-24

**Status:** In progress; not a security sign-off.  
**Review baseline:** PR #230 head `90d4532cf8a48ac0958efbeb35466bda6f69d98d`  
**Hardening branch:** `security/fail-closed-workspace-roles-20261124`  
**Roadmap:** `docs/REXNORA_99_READINESS_ROADMAP.md`

This review separates controls present in open candidate branches from controls verified in a running, authenticated staging environment. An open PR or passing static test is not evidence that a control is shipped.

## Controls present in the candidate code

| Area | Evidence reviewed | Assessment |
|---|---|---|
| Authentication | Supabase `auth.getUser()` on protected page/API paths; expired dashboard sessions fail closed; password recovery/update and sign-out paths in PR #230 | Implemented in candidate; authenticated staging acceptance pending |
| Workspace authorization | `lib/supabase/permissions.ts`; per-route permission checks for workflows, agents, integrations, dashboards, members, billing and real-estate data | Broad route coverage in candidate; role resolution hardening added in this branch |
| Custom roles | Permission keys are allowlisted; custom-role reads are scoped by both role ID and workspace ID; manage permissions imply corresponding view permission | Implemented in candidate; needs cross-tenant runtime tests |
| Secret storage | Server-only admin client; AES-256-GCM credential envelopes; v2 associated data binds workspace, provider and connection ID; credential RPC is owner/admin-checked and service-role-only in PR #226 | Strong storage design in candidate; connected-staging verification pending |
| OAuth | Signed, short-lived provider/workspace/user state; HTTP-only callback cookie; PKCE where supported; user/workspace/owner-admin checks before token exchange and persistence | Implemented in PR #230; the separate PR #231 repeats the same owner/admin gates and should not be integrated as a competing duplicate |
| Webhook ingress | Hashed endpoint lookup; HMAC over raw body and event metadata; 5-minute timestamp tolerance; payload-size limits; event receipt and payload-hash replay checks | Implemented in candidate; real provider-signed staging acceptance pending |
| Billing webhooks | PR #233 introduces atomic claim/complete/release RPCs with lease fencing and a concurrent-claim regression test | Candidate-only; depends on PR #230 and its migrations have not been applied to connected staging |
| Integration revocation | PR #233 adds owner/admin-checked transactional local revocation; worker rechecks selected connection state and secret before provider actions | Candidate-only; staging acceptance pending |
| SSRF / arbitrary HTTP | `nodes/safe-http.ts` rejects private and special-use addresses, resolves and pins DNS, blocks unsafe headers/ports, bounds request/response sizes, and supports abort/timeout | Strong source-level control; requires adversarial runtime coverage |
| Request validation | Sensitive routes enforce bounded body sizes, UUID checks, same-origin checks on browser mutations and private/no-store responses | Present across reviewed candidate paths; coverage is not yet a complete runtime security test |

## Fix included in this branch

The PR #230 permission resolver previously granted `DEFAULT_MEMBER_PERMISSIONS` to every non-owner/non-admin membership without a custom role. That included an unexpected or null role value.

The resolver now grants the default permission set only when the stored role is exactly `member`. Unknown, null and future role values receive an empty permission map. Custom roles are also evaluated only for the explicit `member` role. This is a fail-closed application-layer guard; the database custom-role assignment trigger remains an independent boundary.

Regression coverage verifies the guard occurs before custom-role and default-role permission handling.

## Material gaps before security sign-off

### 1. Distributed abuse protection — open

No shared, distributed rate-limiter was identified in the reviewed application candidate. A per-process in-memory limiter would not be a reliable control for serverless/multi-instance deployments and is deliberately not presented as a solution.

Required before customer-facing launch:
- Distributed limits by IP and, after authentication, by user/workspace for sign-in/recovery/resend, OAuth initiation, credential tests, public intake and public webhook ingress.
- Separate limits for expensive model/provider operations, including connection-test cooldowns.
- A documented response policy (429, bounded `Retry-After`, no sensitive detail) and monitoring for repeated blocks.
- An atomic shared store or edge/WAF control with configured production values and verified deployment evidence. The Supabase-backed option must be coordinated with the separate Supabase security/migration workstream; do not add or apply a database migration from this branch.

The public webhook route's current count-before-dispatch check of 100 runs per workflow per hour is not atomic under concurrency and must not be treated as a hard abuse boundary. The durable dispatcher does enforce an atomic workspace monthly execution quota under a workspace-scoped database lock, but that quota does not replace ingress rate limiting.

### 2. Encryption-key rotation — open

Credential envelopes use AES-256-GCM and v2 associated data, but the reviewed format does not carry a key identifier or a multi-key decrypt/re-encrypt rotation lifecycle. Preserve the current `AIVANTA_CREDENTIALS_ENCRYPTION_KEY`; replacing it would make existing ciphertext unreadable. Before production, define a versioned keyring, controlled re-encryption/rollback procedure, access audit and operator runbook. Do not rotate the connected staging or production key as part of this review.

### 3. Tenant-boundary runtime acceptance — open

The PR #230 staging record reports RLS enabled on core workspace/workflow/run/agent/real-estate tables and no browser grants/policies on the integration-secret table. However, the connected staging database has migration-history drift (262 recorded versions versus 144 source migration files, with five source migration versions absent). No migration reconciliation or authenticated two-workspace acceptance is authorized here.

Required: two independently authenticated workspaces; owner/admin/member/custom-role matrix; cross-workspace resource ID substitution for workflows, jobs, agents, leads, properties, integrations, invitations and billing; secret table/API/browser denial; and revocation while a workflow is queued. Record only sanitized evidence.

### 4. Security regression depth — open

Many existing tests are source-contract assertions. They are useful guardrails but do not prove runtime enforcement. Add authenticated integration/browser tests against isolated staging once the migration-history and Preview credential blockers are resolved. Include abuse bursts and concurrent webhook deliveries, not only single-request happy paths.

## Release decision

**Not passed.** This review does not certify Stage 9 or authorize launch. Do not merge PR #230/#233 or apply connected migrations based on this document. The next security acceptance dependency is a coordinated distributed rate-limit design plus authenticated two-workspace staging tests after the Supabase migration-history issue is reconciled.

## Safety boundary observed

No connected Supabase migration, credential, Vercel environment variable, production deployment, provider send, billing action or customer data was changed during this review.


## Follow-up implementation on the security branch

The follow-up adds a key-ID-bearing v3 AES-256-GCM envelope for workspace integration credentials, with workspace/provider/connection AAD. v1/v2 remain readable through the legacy key. New writes switch to v3 only after a valid keyring is configured. A dry-run-first rotation utility creates ciphertext-only backups and supports explicit restore.

A shared database-backed API limiter adds atomic upsert windows, hashed identifiers, RLS and service-role-only execution. It is wired into AI generation, integration write/delete/test flows, Google and provider OAuth starts, Resend setup test-email, signed webhook ingress and public real-estate intake. The non-atomic webhook hourly count gate is removed in favour of an atomic workflow/resource bucket.

This is not a security sign-off. The migration has not been applied to any connected Supabase project. Do not configure the keyring or run rotation before applying the migration to the intended environment and retaining old keys for rollback. Google OAuth token encryption and webhook signing-secret encryption use separate stores/keys and are outside this rotation utility. Authenticated two-workspace staging proof and full release-gate CI remain outstanding.
