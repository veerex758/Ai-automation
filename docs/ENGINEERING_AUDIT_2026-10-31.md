# Aivanta engineering audit — 2026-10-31

## Executive status

Aivanta has a meaningful application and workflow foundation, but it is not yet a production-grade general automation platform or an n8n replacement. The immediate objective is to consolidate and verify the work already in progress before expanding the feature set.

This audit is based on the repository's `main` branch at `4a772d53d48858b65fb9e35702f8f353bcbd1408`, the open pull requests listed below, and the connected Vercel/Supabase project metadata available on the audit date. Features on unmerged branches are not counted as shipped on `main`.

## Verified on main

- Next.js 15 / React 19 / TypeScript application foundation.
- Supabase SSR authentication and workspace-scoped workflow persistence.
- Visual workflow builder, workflow validation, definition versioning and run-history foundation.
- Dry-run workflow execution and a guarded first live Resend/email path.
- AI workflow drafting that produces reviewable drafts rather than silently executing them.
- Server-owned action catalog and initial scheduled-workflow dispatcher foundation.
- CI scripts for tests, lint, type checking and production build.
- Database migrations through the workspace race-safe default-workspace migration dated 2026-10-14.

## Significant work on open branches — not yet shipped on main

The following pull requests were open at audit time. Their exact-head CI results and branch relationships must be rechecked before merging.

| PR | Scope | Status at audit |
|---|---|---|
| #86 | Workspace integrations execution, credentials, provider execution and guided quick setup | Open draft; CI run 632 passed; staging and DB acceptance outstanding |
| #87 | Gemini workflow generation provider | Open; verify exact-head CI and integration with the current AI planner |
| #88 | Switch / Route logic node | Open; verify exact-head CI and downstream branch execution |
| #89 | AI-planned universal HTTP executor and schema-based workflow planner | Open draft; CI run 668 passed; staging acceptance outstanding |
| #90 | Encrypted workspace credential vault and migration | Open; staging migration and encryption-key configuration outstanding |
| #91 | Workspace integrations connection manager UI | Open draft; depends on integration schema and server-side encryption key |
| #92 | Workspace-scoped HTTP API credential documentation correction | Open; CI run 676 passed |

These PRs do not all target `main`. Several are based on intermediate feature branches. Do not merge them independently or assume their features are available in production. First establish a deliberate dependency order, rebase/retarget where appropriate, and run CI on each exact final head.

## Environment and release findings

- GitHub repository: `veerex758/Ai-automation`; default branch: `main`.
- The connected Vercel project has a READY deployment from a feature branch. READY means the deployment build completed; it does not prove production promotion, public accessibility, or authenticated end-to-end acceptance.
- The Supabase connector currently exposes only project `sjrzgzatnnlyyatrpsww` (`supabase-cobalt-harbor`). The intended project selected for this audit is `xymbwkegcpjxlgclqiop`, but the connected Supabase account cannot access it and returns a permission error. No database was changed.
- Repository history and earlier project documentation identify `xymbwkegcpjxlgclqiop` as the dedicated Aivanta project. This identity must be re-confirmed in the Supabase dashboard and connector access restored before schema inspection or migration execution.
- The main branch contains migrations through 2026-10-14. Integration and credential-vault migrations on feature branches are not confirmed applied to any database.

## Product capability assessment

### Workflow authoring
- Present: workflow definitions, validation, builder foundation, AI-generated draft flow, templates and node registry work on feature branches.
- Remaining: a complete graph editor with explicit edges, branch visualization, mapping UX, version diff/rollback UX, accessibility and small-screen authoring acceptance.

### Execution engine
- Present: dry-run execution, bounded manual execution paths, run records, step records, idempotency foundations and guarded live email.
- Remaining: durable queue/worker separation, persisted per-step checkpoints, retry/backoff policy, lease recovery, dead-letter queue, cancellation, pause/resume, timeout enforcement, concurrency limits, replay semantics and end-to-end execution tracing.
- Important: the current registered runner executes an ordered list sequentially and holds prior outputs in process memory. It is not a durable graph orchestrator. Do not market it as such.

### Triggers and event delivery
- Present: manual trigger, scheduled-workflow foundation and webhook schema/ingress work on feature branches.
- Remaining: reliable webhook-to-queue dispatch, signature verification per provider, event deduplication, replay windows, scheduled dispatch recovery, timezone/DST correctness, polling triggers and event delivery monitoring.

### Integrations
- Present: initial email execution; provider node definitions and workspace credential work on feature branches.
- Remaining: production-verified connectors, OAuth authorization and refresh lifecycle, token revocation, credential rotation, per-connection health, provider rate-limit handling, connector contract tests, versioning and a public/custom connector SDK.
- A registry entry or connection-test UI is not proof that an operation is safe and live-capable.

### AI automation
- Present: AI-assisted workflow drafting and provider-specific generation work.
- Remaining: grounded planning against the live node catalog, schema/type-aware mappings, deterministic validation, tool execution policy, approval gates, prompt-injection defenses, bounded agent loops, cost budgets, evaluations and safe recovery.
- Keep AI-created workflows reviewable. Never silently activate or run generated side effects.

### SaaS and global readiness
- Remaining: plan/usage metering, billing lifecycle, workspace roles and invitations, audit exports, abuse controls, API keys, localization, timezone/currency handling, data retention controls, regional strategy, support tooling, backup/restore drills and incident response.

## Recommended architecture

1. **Web/API layer (Vercel):** UI, authenticated API endpoints, validation, workflow authoring and control-plane operations. Avoid long-running execution inside request handlers.
2. **Control plane (Postgres/Supabase):** tenants/workspaces, workflow definitions and versions, credentials metadata, run records, durable execution state, event receipts, usage and audit data. Enforce tenant isolation with RLS and narrowly scoped server-side privileges.
3. **Durable dispatch:** transactional enqueue/outbox pattern so a committed workflow event cannot be lost between database writes and queue publication.
4. **Worker plane:** separately deployed workers claim jobs with leases, execute bounded steps, persist checkpoints, heartbeat, retry with backoff and recover abandoned leases.
5. **Execution model:** explicit graph edges and typed node inputs/outputs; deterministic routing; bounded parallelism; durable waits; cancellation; idempotency keys; retry policy per step; compensation/approval for consequential actions.
6. **Connector runtime:** standardized schemas, auth adapters, secret vault, rate-limit handling, timeouts, safe network transport, sanitized logs and contract tests.
7. **AI planner:** proposes a typed workflow graph from user intent; validator checks node availability, data types, permissions and limits; user reviews; only then can an explicitly activated workflow run.

Choose queue/orchestration technology after a small load/recovery proof-of-concept. Evaluate PostgreSQL-backed queues, Redis-backed queues and dedicated durable workflow engines against operational burden, retry semantics, visibility, cost and deployment compatibility. Do not adopt multiple overlapping queue systems without a clear reason.

## Ordered roadmap

### P0 — Re-establish a trustworthy baseline
- Confirm the authoritative Supabase project and restore connector access to it.
- Compare applied database migrations against the repository migration history.
- Capture the current `main` commit, deployment commit, environment-variable names (never values), domain and promotion state.
- Inventory all open PRs, branch ancestry, CI and changed migrations.
- Create one dependency-ordered integration branch/merge plan; remove stale branches only after their work is accounted for.
- Run exact-head tests, lint, typecheck and build on the consolidated branch.
- Complete authenticated staging sign-up, workspace isolation, save/reload, dry-run and run-history acceptance.

**Exit gate:** one known-good mainline, one known-good staging database, reproducible migrations, and a verified staging workflow lifecycle.

### P1 — Production-grade execution core
- Define a versioned workflow graph and execution-state contract.
- Implement durable dispatch/outbox, worker leases, heartbeats and checkpoint persistence.
- Add bounded retries/backoff, idempotency, dead-letter handling, cancellation and safe replay.
- Add concurrency and per-workspace resource limits.
- Add structured, redacted logs and trace IDs across trigger → run → step → connector.

**Exit gate:** workers can be terminated/restarted during a run without losing or duplicating completed side effects; failure and replay tests pass.

### P2 — Complete graph semantics
- Explicit edges, IF/ELSE and Switch routing.
- Parallel branches and deterministic joins.
- Loops with iteration/time/cost limits.
- Durable Delay/Wait and resume.
- Error branches, sub-workflows and human approvals.

**Exit gate:** graph execution is deterministic, bounded, resumable and fully represented in run history.

### P3 — Reliable trigger and connector platform
- Queue-backed webhook delivery and scheduled dispatch.
- OAuth2 authorization, refresh, revocation and credential rotation.
- Connector SDK and contract test suite.
- Expand connectors based on demand; verify each live operation separately.
- Document connector scopes, rate limits, data handling and failure behavior.

**Exit gate:** every live connector has explicit capability status, auth lifecycle, tests, limits and observable failures.

### P4 — AI-native authoring and agents
- Plan from actual node schemas and typed output contracts.
- Explain mappings and missing connections.
- Validate generated graphs before save.
- Support natural-language editing of existing workflows.
- Add agent tool permissions, budgets, evaluation suites and approval gates.
- Protect against prompt injection from user data and connector responses.

**Exit gate:** AI drafts are correct on a representative evaluation set and cannot bypass workflow permissions or execution safety policies.

### P5 — Global SaaS and scale
- Billing, usage metering and plan enforcement.
- Workspace roles, invitations and auditability.
- Localization, timezones and regional data policy.
- Backups, restore drills, SLOs, alerting and incident playbooks.
- Abuse prevention, retention/export/deletion controls and customer support operations.

**Exit gate:** operational readiness review with measured reliability, costs, security and support ownership.

## Non-negotiable engineering rules

- Never run a migration against an unconfirmed project.
- Never commit credentials or expose server secrets to the browser.
- Never treat a green CI run or READY deployment as staging acceptance.
- Never claim a node is live-capable unless its adapter, auth, limits and failure behavior are implemented and tested.
- Never silently execute AI-generated workflows.
- Every side-effecting step must have a documented idempotency and retry policy.
- Every tenant-owned record and execution action must be authorized against the active workspace.
- Every release must have a rollback/recovery plan.
