# Rexnora 99% readiness delivery plan

**Plan owner:** Lead engineering  
**Created:** 2026-11-14  
**Baseline:** Main SHA `b2ed613bd9e2f3762fd485e1dbe688af015c412a` (audit snapshot; re-baseline before execution)  
**Related audit:** [REXNORA_DELIVERY_LEDGER.md](./REXNORA_DELIVERY_LEDGER.md)

## Mission and target

Move Rexnora from a substantial but incompletely proven automation platform to a dependable, customer-usable SaaS product.

**99% ready** is an engineering release target for the agreed launch scope, not a claim that every imaginable feature or every listed integration is complete. We will measure readiness using accepted requirements and evidence. A capability is not complete merely because a page, schema, registry entry, or PR exists.

The launch-critical product journey is:

1. A customer describes an automation in plain language.
2. Rexnora (using Gemini as the configured AI provider) generates a valid workflow from registered capabilities.
3. The customer can inspect, edit, validate and test the workflow without side effects.
4. The customer explicitly activates it with approved credentials and usage limits.
5. The runtime executes it reliably, records each outcome, retries safely where appropriate, and makes failures understandable.
6. The customer can see the business result, usage and operational status.

**First commercial proof:** one real-estate agency workflow: enquiry intake → Gemini qualification → authorized Resend notification → persisted lead/run outcome → agency confirms value.

## Rules of execution

- Work in dependency order. One active delivery stage at a time; do not start marketplace expansion while the pilot path is broken.
- Work from a freshly checked main SHA and exact PR head SHAs. Open PR work is not shipped work.
- Use small, reviewable PRs. Do not push directly to main.
- Do not merge on the strength of a green unit-test badge alone. Require lint, type-check, tests, production build, migration checks and the relevant staging/browser/provider evidence.
- Never claim an integration is live because it appears in the catalogue. Track: listed → registered → executable → credentials connected → provider verified → customer accepted.
- Use Gemini for AI operations. Make provider selection deterministic and test it even when multiple provider keys are present.
- Keep live side effects disabled by default. Require explicit activation, workspace authorization, recipient allowlists/permissions, usage limits, idempotency and a kill switch.
- Preserve existing customer data and production configuration. No destructive migration or secret rotation without a reviewed plan and explicit authorization.
- Customer acquisition remains the commercial north star. Build only what is needed to deliver and prove customer value.

## Delivery stages

### Stage 0 — Re-baseline and establish engineering control

**Objective:** Know exactly what is shipped, what is only on branches, and what is currently deployable.

Work:
- Re-check main HEAD, open PRs, PR bases/dependencies, exact-head CI, Vercel deployments and Supabase migration state.
- Review PR #207 (product core), #211 (Rexnora branding), and #212 (this documentation) against current main; inspect conflicts and changed files.
- Identify whether #210 is still stacked on #208 and preserve dependency order.
- Confirm current required environment-variable names and which are configured without exposing secret values.
- Establish a clean baseline for lint, type-check, unit/integration tests and production build.

Exit gate:
- A dated baseline records exact SHAs and statuses.
- No PR is described as shipped before merge.
- A usable preview path and a known staging environment are identified, or a specific blocker/owner is recorded.

### Stage 1 — Make the product core mergeable and deployable

**Objective:** Get the core workflow engine changes safely onto main.

Work:
- Finish review and verification of PR #207: graph edges, conditional branches, reachability validation, registry-driven activation, durable worker lifecycle, webhook queue foundations and agent tool boundaries.
- Fix all failing tests and type/lint/build issues on the exact PR head.
- Reconcile migration order and run clean migration replay plus database adapter integration.
- Resolve deployment capacity/build failures; deploy a preview from the exact candidate SHA.
- Test rollback/recovery path before merging.

Exit gate:
- Exact-head CI passes (lint, type-check, tests, production build and migration/integration checks).
- Preview is ready and its deployed SHA matches the accepted candidate.
- Authenticated staging tests pass for workflow create/edit/save/reload, graph branches, validation, dry-run, activation/deactivation, run history and workspace isolation.
- Merge only after review and all required gates pass.

### Stage 2 — Finish the AI-first workflow authoring journey

**Objective:** Make natural-language automation generation useful, structurally correct and safe.

Work:
- Enforce Gemini as the default/configured provider; test provider selection when both Gemini and OpenAI keys exist.
- Generate registered workflow nodes plus explicit graph edges, branches and valid connections—not merely a linear list.
- Validate every generated node against the node registry and every edge against graph constraints.
- Reject unknown node IDs, invalid configuration, unreachable branches, malformed output and unsupported operations.
- Show the customer a clear draft, explain what each step does, highlight missing credentials/fields and allow edits before testing.
- Add bounded prompts/input sizes, structured output validation, timeout handling, retries where safe, usage accounting and sanitized error messages.
- Ensure generation never activates or executes a workflow automatically.

Exit gate:
- A defined test suite of representative beginner and advanced requests generates valid graphs.
- Invalid AI output is rejected safely and is repairable without corrupting the draft.
- Gemini is proven to be the active provider in automated tests and staging.
- Generated workflows can be edited, saved, reloaded and dry-run by an authenticated workspace user.
- No generated draft causes live external side effects.

### Stage 3 — Harden execution, triggers and recovery

**Objective:** Make approved workflows dependable after activation.

Work:
- Verify worker leases, checkpoints, concurrency limits, cancellation, resume, retry policy and dead-letter/error handling.
- Verify idempotency for webhook deliveries and provider actions to prevent duplicate leads/emails.
- Complete signed webhook validation, timestamp/replay protection, endpoint ownership and durable dispatch.
- Complete scheduler claim/dispatch and prove scheduled execution; keep unsupported trigger types visibly unavailable.
- Ensure deactivation/kill switch prevents new work and handles in-flight work predictably.
- Persist run-level and step-level states, timestamps, correlation IDs and safe diagnostic context.
- Add operational alerting for repeated failures, stuck jobs and exhausted retries.

Exit gate:
- Staging proves success, controlled provider failure, safe retry, duplicate delivery, cancellation, deactivation and recovery.
- No duplicate customer-visible side effect occurs in idempotency tests.
- Operators can trace a run from trigger through every step without exposing secrets or sensitive payloads.

### Stage 4 — Verify the integration catalogue honestly

**Objective:** Turn the catalogue into trustworthy, usable integrations without pretending all entries are live.

Work:
- Reconcile the source of truth for native executable nodes and provider-directory entries; remove stale inventory counts.
- For each provider, record node mapping, operation coverage, auth method, credential storage, required scopes, rate-limit behavior, error mapping and test evidence.
- Prioritize integrations required by the first customer workflows. Do not spend time live-certifying all 100 providers before customer demand.
- Complete real authenticated provider tests for the first-pilot stack: lead source/webhook, Gemini and Resend.
- Verify credential connect/update/revoke flows and ensure credentials are workspace-scoped and encrypted.
- Mark each integration accurately as listed, registered, executable, credential-connected, provider-verified or customer-accepted.
- Add provider contract tests and sandbox tests where available; document providers that require manual customer credentials.

Exit gate:
- The first-pilot integrations pass real provider tests using controlled credentials.
- Credential isolation and revoke behavior pass staging checks.
- Catalogue status is truthful and generated workflows cannot select unsupported/unverified operations as live-ready.
- No blanket “100 live integrations” claim is made without evidence.

### Stage 5 — Deliver and validate the real-estate pilot

**Objective:** Prove Rexnora creates measurable business value for an actual agency.

Work:
- Create an isolated pilot workspace with a named agency operator and explicit test/production boundary.
- Connect an authorized enquiry source and validate payload schema, consent/permission expectations and duplicate handling.
- Pass only necessary enquiry fields to Gemini; define qualification criteria and a predictable structured result.
- Send a qualification summary through the agency-authorized Resend sender and recipient.
- Persist lead status, AI result, notification result, run ID, timestamps and failure reason.
- Provide a simple view of new leads, qualified leads, notification status and run history.
- Add manual review/override and a clear path for failed or ambiguous qualification.
- Run a controlled failure/retry test and prove no duplicate email or lost lead.
- Record baseline response time and operator feedback; calculate time saved or faster response only from observed data.

Exit gate:
- At least one authorized agency/test operator completes the full flow in staging.
- Successful run and controlled failure/recovery evidence are recorded.
- Agency operator confirms the result is useful and understands how to pause/disable it.
- There is a repeatable onboarding checklist and a support/escalation path.
- Only after this gate do we broaden the pilot to additional agencies or workflows.

### Stage 6 — Ship Rexnora identity and usable product experience

**Objective:** Make the product coherent, accessible and trustworthy across devices.

Work:
- Finish PR #211 and audit every logo, wordmark, favicon, metadata title/description, social preview and legacy Aivanta reference.
- Apply the approved brand system consistently across marketing pages, authentication, dashboard, builder, settings, billing and empty/error/loading states.
- Verify responsive layouts on narrow mobile screens and desktop; fix overflow, inaccessible controls and page-specific mobile failures.
- Improve onboarding so a first-time user can create a workspace, connect a provider, generate a workflow, test it and understand activation.
- Make empty states, validation errors, permissions, usage limits and execution failures actionable and plain-language.
- Add keyboard/focus/accessibility checks and consistent loading/success/error feedback.

Exit gate:
- All app routes use the approved Rexnora identity; obsolete Aivanta branding is removed where it should be.
- Visual regression/manual checks pass on mobile and desktop for critical journeys.
- New user can complete the first workflow journey without engineer intervention or unexplained blockers.
- Brand PR CI and deployment pass on the exact merged SHA.

### Stage 7 — Complete SaaS workspace, usage and billing foundations

**Objective:** Make the product commercially operable for multiple customers.

Work:
- Review and finish PR #208 after core workflow and pilot gates.
- Prove workspace roles, invitations, membership changes and tenant isolation at runtime.
- Meter usage consistently for AI calls, workflow runs and billable operations; prevent double charging on retries.
- Implement usage reservations/limits and clear customer-facing usage visibility.
- Verify billing lifecycle: checkout, webhook signature verification, subscription state, renewal, failed payment, cancellation, refunds/credits where supported and reconciliation.
- Keep plan definitions and limits explicit; do not publish pricing that is not configured and enforceable.
- Add invoices/receipts and support for customer billing questions.

Exit gate:
- Two or more isolated workspaces pass authenticated access tests.
- Metering reconciles with execution records and retry behavior.
- Billing provider sandbox tests pass end-to-end, including webhook replay and failed-payment recovery.
- Customer can see plan, usage, billing state and cancellation path.
- No live charge is made during testing.

### Stage 8 — Production security, reliability and operations

**Objective:** Reduce the risk of data exposure, silent failures and unrecoverable incidents.

Work:
- Threat-model authentication, workspace boundaries, workflow inputs, webhook endpoints, AI prompts, provider credentials and admin operations.
- Verify RLS with authenticated users across separate workspaces, not only migration/static tests.
- Verify secret encryption, access boundaries, rotation/revocation and redaction from logs.
- Add rate limits, abuse controls, payload limits, request validation and safe output handling.
- Establish backup/restore expectations and run a recovery drill.
- Define SLOs and alert thresholds for API availability, worker latency, queue age, execution failure and provider error rates.
- Add incident runbooks, audit events, retention/deletion behavior and support diagnostics.
- Run dependency/security scanning and remediate critical/high findings before launch.

Exit gate:
- Security tests show no cross-workspace access or credential leakage.
- Recovery drill restores the agreed data and service state.
- Alerts fire for simulated incidents and operators can follow runbooks.
- No unresolved critical/high security issue remains for the launch scope.
- Data handling, retention and privacy disclosures match actual behavior.

### Stage 9 — Marketplace and advanced agent capabilities

**Objective:** Expand the platform only after the core automation SaaS is stable and customers validate demand.

Work:
- Fix PR #209 verification failures and review marketplace install/update/rollback boundaries.
- Validate publisher identity, package integrity, permissions, version pinning, rollback and audit history.
- Test checkout and payment-provider webhooks in sandbox; prove ledger/reconciliation and refund paths before enabling real transactions.
- Review PR #210 as dependent on #208; validate recurring payment mandates, renewal retries, cancellation, invoices and jurisdiction-specific tax configuration.
- Evolve agents beyond model-only runs in controlled increments: explicit tool permissions, scoped credentials, approval gates, budgets, execution traces and bounded retries.
- Keep agent tools read-only by default; require explicit approvals for external side effects.

Exit gate:
- Marketplace install/update/rollback and payment flows pass security and provider sandbox acceptance.
- Recurring billing and tax behavior are reviewed for the actual launch jurisdictions.
- Agent tool execution is permission-scoped, observable, budgeted and tested against prompt-injection/tool-abuse cases.
- These capabilities are released only if customer demand justifies their operational cost.

### Stage 10 — Launch acceptance and 99% readiness sign-off

**Objective:** Make the release decision from evidence, not optimism.

Work:
- Run the complete critical-path acceptance suite on the exact release candidate SHA.
- Verify clean install/migration replay, production build, preview/production deployment and rollback plan.
- Run browser acceptance on mobile and desktop using fresh customer accounts.
- Verify the first-pilot workflow and at least one additional representative workflow.
- Review provider verification matrix, support runbooks, monitoring, backups, pricing/usage enforcement and customer onboarding.
- Collect explicit pilot/customer acceptance and record known limitations.
- Publish release notes and a truthful capability/status page.

Exit gate:
- 99% of launch-scope acceptance criteria are passed and evidenced; the remaining 1% is documented, non-critical and has an owner/date.
- All critical security, data-loss, billing-integrity and duplicate-side-effect risks are closed.
- No P0/P1 launch blocker remains.
- Exact release SHA, CI runs, deployment URL, migration version, provider evidence and customer acceptance are recorded.
- Engineering lead and product owner approve the release.

## Readiness scorecard

The score is a weighted progress measure, not a substitute for release gates. Each requirement is scored only when evidence exists on the candidate branch/environment.

| Workstream | Weight | What earns credit |
|---|---:|---|
| Core authoring and graph engine | 15% | Valid AI-generated graphs, editing, validation, save/reload and dry-run |
| Execution and trigger reliability | 15% | Durable workers, triggers, retries, idempotency, cancellation and traceability |
| AI quality and Gemini governance | 10% | Deterministic Gemini selection, structured output, safe failure and usage limits |
| Pilot integrations | 10% | Real credentials and successful provider tests for the defined launch stack |
| Customer pilot and value proof | 15% | End-to-end agency acceptance, recovery test and observed business value |
| Security and tenant isolation | 10% | Authenticated RLS, secrets, webhook and abuse-control tests |
| UX, onboarding and Rexnora brand | 8% | Mobile/desktop critical journey and consistent identity |
| SaaS usage and billing | 7% | Workspace, metering and sandbox-tested billing lifecycle |
| Operations and release engineering | 7% | CI, deployment, monitoring, backup/restore and incident readiness |
| Marketplace and advanced agents | 3% | Scoped, tested capabilities required by launch scope |
| **Total** | **100%** | |

**Scoring policy:** Not started = 0; implemented but unverified = at most 25% of that workstream's weight; automated tests pass = at most 60%; staging/provider acceptance passes = at most 85%; customer/operational acceptance passes = 100%. A blocked critical gate prevents a “ready” declaration even if the weighted score is high.

## Immediate execution queue

The first sequence after this plan is approved:

1. Recheck current main and PR #207/#211/#212 exact heads and CI; do not rely on the dated audit alone.
2. Finish the product-core PR and obtain a usable preview from its exact SHA.
3. Run authenticated staging acceptance for the graph builder, Gemini draft, dry-run, activation, worker lifecycle and workspace isolation.
4. Prove the real-estate lead → Gemini → Resend → persisted outcome flow with a controlled failure/retry.
5. Finish Rexnora brand consistency and mobile/desktop critical-path checks.
6. Then complete SaaS billing/operations; defer marketplace expansion unless a pilot customer requires it.

## Engineering status log

Update this section after each stage with date, PR/commit, CI links, preview SHA/URL, test evidence, blockers and the next stage. Never mark a stage complete from code review alone.

| Stage | Status | Evidence / PR / SHA | Blockers | Accepted by / date |
|---|---|---|---|---|
| 0 — Re-baseline | Not started | | | |
| 1 — Product core | Not started | | | |
| 2 — AI authoring | Not started | | | |
| 3 — Execution reliability | Not started | | | |
| 4 — Integration verification | Not started | | | |
| 5 — Real-estate pilot | Not started | | | |
| 6 — Brand and UX | Not started | | | |
| 7 — SaaS billing and workspace | Not started | | | |
| 8 — Security and operations | Not started | | | |
| 9 — Marketplace and agents | Not started | | | |
| 10 — Launch sign-off | Not started | | | |

**Lead-engineering commitment:** Drive one stage to its exit gate, record the evidence, then move to the next. Keep the main branch releasable, protect customer data, and prioritize a working customer outcome over feature count.
