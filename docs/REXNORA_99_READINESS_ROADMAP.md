# Rexnora 99% Readiness Roadmap

**Owner:** Lead Engineering  
**Created:** 2026-11-14  
**Baseline:** Read-only audit of repository `veerex758/Ai-automation`, main snapshot `b2ed613bd9e2f3762fd485e1dbe688af015c412a`  
**Target:** A dependable, secure, commercially usable Rexnora release that can onboard real customers and deliver measurable automation value.

> This is an execution roadmap, not a claim that the product is already 99% ready. The audit's 57/100 estimate is a product-fit heuristic, not a test result. Progress will be recalculated only from verified implementation and acceptance evidence. "99%" means the defined product scope and release gates are satisfied; it does not mean every possible integration or future feature exists.

---

## 1. Product definition and non-negotiable journey

Rexnora is an AI-first automation platform for beginners through developers. Its primary journey is:

1. A user describes an outcome in natural language.
2. Rexnora (Gemini as the selected AI provider) generates a valid workflow using registered operations.
3. The user can inspect, edit and understand the workflow and its connections.
4. The user can test the exact saved version without causing unintended external side effects.
5. The user explicitly activates it after permissions, connections, quotas and safety checks pass.
6. Rexnora executes it reliably, reports each step, retries safely where appropriate, and records measurable outcomes.
7. The user can monitor usage, failures, costs and business value.

**First commercial proof:** a real-estate enquiry workflow:

Lead captured → Gemini qualifies the enquiry → Resend sends the approved summary to the correct agency recipient → outcome is persisted and visible.

The first release must prove this one customer outcome end to end before we broaden the sales story. Marketplace expansion and catalogue growth must not displace this milestone.

## 2. Delivery rules

- Main branch is the release source of truth. Work in focused branches and pull requests; do not make unreviewed direct-main changes.
- An open PR is not shipped. A passing CI run on an old SHA is not evidence for a newer SHA.
- Every merge requires exact-head CI: tests, lint, type-check, production build, migration replay and applicable database integration checks.
- A skipped check is **not** a pass. Record why it was skipped and supply an equivalent acceptance check where required.
- Static/source-contract tests do not replace authenticated staging, real provider sandbox checks or customer acceptance.
- Keep live execution fail-closed. No secret, credential, production data, real payment, or production migration changes without explicit authorization and a verified release plan.
- Use Gemini for product AI work. Verify the provider selection in code and deployment configuration; do not silently fall back to OpenAI.
- Count integrations honestly: catalogue entry, registry mapping, executable operation, credential connection, provider verification and customer acceptance are different states.
- Keep scope focused on the first real-estate pilot until it produces repeatable evidence.

## 3. Staged delivery plan

Completed-stage evidence is maintained in [REXNORA_ENGINEERING_BASELINE_2026-11-15.md](./REXNORA_ENGINEERING_BASELINE_2026-11-15.md). The detailed Stage 0 section is removed; only active stages remain below.

### Stage 1 — AI-generated workflows must be real graphs

**Objective:** Make the defining AI-first experience produce workflows the runtime can actually execute.

**Work**
- Complete and verify #207 graph-generation work: explicit nodes and edges, registered operation IDs, validated inputs, condition branches and reachability.
- Ensure the canvas renders generated nodes and edges faithfully and supports edit, save, reload and version identity.
- Validate endpoints, branch sources, cycles, unreachable nodes, missing required inputs and unsupported operations.
- Ensure generated drafts are review-only. Generation must never activate or execute a workflow.
- Make Gemini the deterministic configured provider. Correct provider precedence and test the case where both Gemini and OpenAI keys exist.
- Add tests for malformed model output, unknown operations, invalid edges, partial graphs and model/provider errors.
- Show useful validation errors in the UI, not raw internal exceptions.

**Exit gate**
- Prompt → Gemini → valid graph → editable canvas → save → reload works in authenticated staging.
- Conditional branches survive save/reload and execute the expected branch in a controlled test.
- Invalid model output is rejected safely.
- No workflow executes from generation alone.
- Runtime provider evidence confirms Gemini was used.

### Stage 2 — Safe, durable and observable workflow execution

**Objective:** Make activation and execution trustworthy beyond the original three-step demo.

**Work**
- Verify the generic activation path in #207 against the exact saved workflow version, registered operations, workspace connections, operation approvals and live-execution controls.
- Keep dry-run and live execution clearly separate.
- Verify worker lease renewal, lease-loss aborts, checkpoints, retries, idempotency, cancellation, resume and finalization.
- Ensure a retry cannot duplicate an email or other external side effect when the provider supports idempotency; otherwise document and enforce a safe policy.
- Verify signed webhook ingress, timestamp/signature checks, replay protection, event receipts and durable queue dispatch.
- Prove scheduler behavior with real staging schedules; do not call a dry-run scheduler production-ready.
- Surface run status, step status, timestamps, retry reason, cancellation and actionable failure details.
- Add dead-letter handling and an operator recovery path for permanently failed jobs.

**Exit gate**
- Manual execution and signed-webhook execution pass in authenticated staging.
- A deliberately induced transient failure retries correctly without duplicate business side effects.
- Cancellation and lease-loss tests prove that stale workers cannot continue live operations.
- The exact workflow version and execution trace are auditable.
- Scheduler claims are limited to the behaviors actually tested.

### Stage 3 — Integration registry, credentials and provider truth

**Objective:** Make integrations dependable, not merely numerous.

**Work**
- Preserve the registry as the single source of truth for executable operations, schemas, permissions and provider mappings.
- Reconcile the current audited baseline (122 executable nodes; 100 provider catalogue entries) with generated inventory documentation and tests.
- For each provider, track distinct statuses: listed, registry-mapped, executable, credentials configured, connection verified, sandbox-tested, live-tested and customer-accepted.
- Build and verify the workspace connection lifecycle: connect/configure, encrypt and store credentials, test, rotate/revoke, permission-check and disconnect.
- Ensure secrets never reach the browser, logs, generated workflow definitions or model prompts.
- Verify workspace-scoped credentials and operation approvals at activation and immediately before each live operation.
- Maintain fail-closed provider allowlists. Do not enable every catalogue entry for live execution by default.
- Expand real-provider verification incrementally based on customer demand; prioritize Gemini and Resend for the pilot.
- Keep MySQL/MongoDB driver verification evidence separate from end-to-end product acceptance evidence.

**Exit gate**
- Every operation used by the pilot has a tested schema, permission policy and verified staging connection.
- Cross-workspace credential and workflow access tests pass.
- Revoked or missing credentials block execution before external side effects.
- Inventory reports the real state for every provider; no claim that all 100 are live-verified.

### Stage 4 — Real-estate pilot: prove customer value end to end

**Objective:** Convert the product core into evidence an agency can evaluate and pay for.

**Work**
- Define a stable real-estate lead input contract: source, contact details, property interest, budget, location, timeline, consent and required metadata.
- Implement and validate lead intake from the agreed first channel. Keep unsupported channels out of the sales promise.
- Send only the necessary enquiry fields to Gemini; validate structured qualification output and handle missing/ambiguous data safely.
- Produce a concise qualification summary with lead intent, fit, urgency, missing information and recommended next action.
- Send the summary through Resend only to an explicitly approved agency recipient.
- Persist lead, workflow run, qualification result, notification outcome, timestamps and failure/retry state.
- Provide an agency-visible result: what arrived, what Rexnora did, what was sent, and whether it succeeded.
- Add duplicate-lead handling, consent/retention rules, safe test data and a controlled failure/recovery path.
- Run a complete acceptance script with an agency representative before calling the pilot customer-ready.

**Exit gate**
- A real or agency-approved test enquiry travels from intake through Gemini, Resend and persisted outcome.
- The agency can inspect the result and confirm that it saves time or improves response handling.
- A failure is visible and recoverable; retries do not send duplicate messages.
- Recipient authorization, data handling and usage limits are enforced.
- At least one agency signs off on the workflow's usefulness. Without this, product readiness may be high but commercial validation remains incomplete.

### Stage 5 — AI agents: honest, bounded capability

**Objective:** Make the agent feature useful without presenting a limited model chat as autonomous automation.

**Work**
- Verify the existing model-only execution label and clearly communicate the current boundary.
- Define a narrow, permissioned tool contract for agents; start with read-only workflow and integration discovery.
- Keep tool calls workspace-scoped, bounded by rounds/output/time and fully audited.
- Add prompt-injection and untrusted-data defenses for workflow content, provider responses and webhook payloads.
- Ensure agents cannot activate workflows, send messages, modify credentials or trigger external side effects unless a separate, explicit approval path is implemented.
- Provide test runs, tool-call traces, clear failure reasons and usage accounting.
- Expand to write/action tools only after approval, confirmation and rollback behavior are designed and tested.

**Exit gate**
- Agent tool calls are restricted, auditable and isolated by workspace.
- Limits and error handling are tested.
- UI accurately distinguishes read-only assistance from actions the agent is not allowed to perform.

### Stage 6 — SaaS foundations: workspaces, usage, billing and operations

**Objective:** Make Rexnora operable as a paid multi-tenant service.

**Work**
- Review and verify #208 before merge; it is the base for #210.
- Prove workspace creation/switching, invitations, role assignment, owner transfer and server-side permission enforcement.
- Prove usage metering is atomic and idempotent across manual, webhook and scheduled runs, including AI generation and agent usage.
- Verify quota reservation, release on failure, over-limit behavior, warnings and plan enforcement.
- Test billing checkout, signed webhook verification, idempotent settlement, pending-payment reconciliation, failed-payment behavior, cancellation and paid-through access.
- Keep #210 recurring Stripe/Paystack and tax invoices behind separate provider/legal acceptance. Do not issue legally represented tax invoices until seller identity and jurisdiction rules are confirmed.
- Verify operational dashboards, worker heartbeats, queue/dead-letter visibility, alerts and alert-delivery history.
- Confirm billing and operations data are workspace-isolated and permissions are enforced server-side.

**Exit gate**
- A staging workspace can subscribe/pay in provider sandbox, receive correct entitlements, consume usage and see accurate billing/usage history.
- Duplicate or forged payment webhooks cannot grant duplicate entitlements.
- Role and workspace isolation tests pass.
- Failed payments, cancellation and paid-through access behave as documented.
- No live-money acceptance is claimed without provider sandbox evidence and explicit finance approval.

### Stage 7 — Rexnora brand, UX and onboarding quality

**Objective:** Deliver one coherent, professional product experience on mobile and desktop.

**Work**
- Complete #211 only after reviewing the actual diff and exact-head checks.
- Audit every logo, favicon, metadata title/description, visible brand name, old Aivanta theme import, CSS token and page-level reference.
- Ensure the approved Rexnora mark and visual system are used consistently across marketing, authentication, dashboard, builder, agents, integrations, billing, marketplace and operational pages.
- Verify responsive layouts at phone, tablet and desktop widths, especially the previously reported mobile-only page error.
- Improve first-run onboarding: create workspace, connect required provider, generate first workflow, review, test, activate and monitor.
- Add empty, loading, error, success, permission-denied and quota states for primary journeys.
- Improve accessibility: keyboard navigation, focus states, labels, contrast, reduced motion and screen-reader semantics.
- Remove obsolete Aivanta naming where it is customer-visible; retain historical/internal identifiers only where renaming would be unsafe or unnecessary.

**Exit gate**
- No unintended legacy Aivanta branding remains in customer-facing pages or metadata.
- Approved logo and palette render consistently.
- Primary user journey works on mobile and desktop with no blocking responsive errors.
- A first-time user can complete onboarding without engineer intervention.

### Stage 8 — Marketplace and broader platform expansion (deferred)

**Objective:** Expand the ecosystem only after the core automation product and pilot are dependable.

**Work**
- Revisit #209 after the core workflow, pilot and SaaS gates are met.
- Verify publisher identity, independent review, immutable version/hash binding, revocation and re-verification.
- Prove staged install/update/rollback without replacing the currently active workflow before explicit apply.
- Keep sandbox checkout isolated from real purchases, entitlements and provider charges.
- Complete provider sandbox, settlement, refund, dispute and reconciliation tests before enabling real-money marketplace flows.
- Add integrations based on customer demand and verified support capacity, not catalogue size alone.

**Exit gate**
- Installation, update, rollback, revocation and uninstall are safe and auditable.
- Sandbox and real-money paths are strictly separated.
- Payment and marketplace claims are backed by provider and operational acceptance.

### Stage 9 — Release hardening and customer acceptance

**Objective:** Establish that the system is safe to launch and support.

**Work**
- Run the complete regression suite on the exact release candidate SHA.
- Complete clean migration replay and authenticated staging tests from a fresh workspace.
- Run security review for authentication, authorization, RLS, secrets, webhook validation, SSRF/network boundaries, input validation, rate limits and audit logs.
- Test backup/restore and document incident response, rollback and support escalation.
- Add monitoring for API errors, worker lag, queue age, provider failures, latency and usage anomalies.
- Confirm privacy notice, terms, data retention/deletion behavior and customer-facing provider disclosures are ready before onboarding customers.
- Run the real-estate pilot acceptance script with controlled data and capture evidence.
- Prepare release notes, known limitations, support runbook and rollback instructions.

**Exit gate**
- Exact release candidate passes all required checks; no required job is silently skipped.
- No unresolved critical/high-severity security or data-isolation issue.
- Authenticated staging acceptance is signed off.
- At least one pilot customer accepts the outcome.
- Rollback and incident response procedures have been exercised.

---

## 4. Readiness scorecard

The score is evidence-weighted. Each category is scored only when its exit evidence exists; planned work and open PRs score zero as shipped capability.

| Category | Weight | Evidence required for full credit |
|---|---:|---|
| AI workflow generation and graph UX | 15% | Gemini graph generation, branch correctness, edit/save/reload, invalid-output handling |
| Execution lifecycle and reliability | 15% | Activation, worker safety, retries, idempotency, cancellation, webhooks and schedules |
| Integrations and credentials | 12% | Accurate registry inventory, secure workspace connections, verified pilot providers |
| Security and tenant isolation | 12% | Authenticated cross-workspace tests, secret protection, permissions and webhook defenses |
| Real-estate pilot and customer value | 15% | End-to-end lead qualification, notification, persisted outcome and agency sign-off |
| AI agents | 6% | Bounded permissioned tools, audit trail, limits and truthful UX |
| SaaS billing, usage and operations | 10% | Correct metering, sandbox payment lifecycle, quotas, dashboards and operational alerts |
| Brand, onboarding and responsive UX | 7% | Complete Rexnora branding, accessible responsive primary journeys |
| Release, support and compliance readiness | 8% | Exact-SHA checks, security review, backup/rollback, policies and support runbook |
| **Total** | **100%** | |

**Readiness bands**
- **0–69%:** Product foundation; not ready for broad customer launch.
- **70–84%:** Controlled pilot candidate; only with explicit limitations and supervised onboarding.
- **85–94%:** Limited commercial launch candidate after customer acceptance and operational sign-off.
- **95–98%:** Release candidate; only minor, non-blocking gaps remain.
- **99%:** Defined release gates passed, core customer outcome proven, no known critical blocker. Remaining 1% represents ongoing learning and real-world variance, not skipped engineering.

A category cannot receive full credit from source inspection alone when its evidence requires a running system, provider sandbox or customer acceptance.

## 5. Pull request handling order

This is the expected order based on the 2026-11-14 audit snapshot; re-check current state before acting:

1. **#207 — Product core:** first priority. Review exact diff and final SHA, verify graph, generic activation, durable execution and agent boundaries. Merge only after all required CI and staging gates pass.
2. **#211 — Rexnora branding:** can progress independently, but review every customer-facing surface and mobile behavior; merge only after exact-head checks.
3. **#208 — SaaS foundations:** review after confirming compatibility with the accepted core and migrations. Keep staging/provider acceptance as release gates.
4. **#210 — Recurring billing/tax invoices:** depends on #208. Defer real recurring payment and invoice claims until provider and legal configuration acceptance.
5. **#209 — Marketplace:** defer until core customer workflow and SaaS foundation are proven.
6. **#212 — Delivery ledger:** revise before merge; its duplicate stage plan conflicts with this authoritative roadmap. Preserve only useful, non-conflicting evidence.

PR numbers and status may change. This ordering is not authorization to merge; current checks and dependencies decide.

## 6. First execution sequence

The current active sequence is:

1. Finish exact-head CI for PR #207 and fix every remaining test, lint, type-check or build failure on that branch.
2. Review and verify the graph-generation path: Gemini output, explicit graph edges, branch validation, editable canvas, save/reload and version identity.
3. Obtain a usable preview from the accepted candidate SHA and complete authenticated staging acceptance for graph generation, dry-run and safe activation.
4. Continue Stage 2 execution-lifecycle verification and Stage 3 integration/provider verification in order; keep their evidence separate from Stage 1.
5. Verify the real-estate Gemini → Resend → persisted outcome path and obtain agency acceptance.
6. Continue independent branding work in #211 with mobile/desktop regression; move to #208 only after core and pilot prerequisites are stable. Defer #209 and #210 until their dependencies and stages are reached.

## 7. Engineering status log

For each stage, record:

- **Status:** Not started / In progress / Blocked / Passed.
- **Branch and PR:**
- **Baseline and final commit SHA:**
- **Files and migrations changed:**
- **Automated checks:** pass/fail/skipped, with run links.
- **Preview and staging evidence:**
- **Provider sandbox/live evidence:**
- **Customer acceptance evidence:**
- **Known limitations and rollback plan:**
- **Exit decision:** Passed / Not passed, with reviewer and date.

Do not advance a stage because code was written. Advance it when its exit gate is demonstrated.
