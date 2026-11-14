# Rexnora delivery ledger and engineering readiness

**Snapshot:** 2026-11-14 UTC  
**Repository:** `veerex758/Ai-automation`  
**Branch assessed as shipped:** `main`  
**Main commit:** `b2ed613bd9e2f3762fd485e1dbe688af015c412a`  
**Purpose:** Separate shipped code, open-branch implementation, automated verification, provider verification, and customer acceptance. This is an evidence ledger, not a launch declaration.

## Executive verdict

Rexnora has a substantial application and automation foundation, but **the repository is not yet evidenced as production-ready for general customer workflows**.

The important distinction is:

1. **Implemented on main** means code is merged into the default branch.
2. **Implemented on an open PR** means code exists, but is not shipped on main.
3. **Automated checks passed** means the exact tested commit passed the named CI jobs.
4. **Provider verified** means an authenticated test against the real provider succeeded.
5. **Customer accepted** means the complete workflow was exercised in an authorized staging/customer environment, including failure handling and evidence.

Do not collapse these states into one percentage or call a registered integration production-ready.

## 1. Main-branch baseline

| Area | Evidence on main at snapshot | Assessment |
|---|---|---|
| Application foundation | Next.js/TypeScript app, marketing pages, authenticated dashboard shell, CI workflow | Implemented |
| Authentication and workspaces | Supabase Auth/session handling, workspace-scoped persistence and RLS foundations | Implemented foundation; runtime isolation still needs authenticated two-user acceptance |
| Workflow authoring | Visual builder, workflow persistence, validation, templates and AI draft/review foundation | Implemented foundation; full graph/branching improvements are in PR #207 |
| Execution | Dry-run execution, run/step history, validation, guarded live-email path | Implemented foundation; durable lifecycle improvements are in PR #207 |
| AI | Gemini/OpenAI-related nodes and authenticated AI draft generation foundation | Implemented foundation; verify configured provider and exact workflow generation in staging |
| Integrations | Native registry and provider directory; see corrected inventory below | Registered does not mean live-provider verified |
| Resend | A guarded email path exists and the project owner has previously reported a successful send test | A narrow real send was reported; this does not establish all-path or multi-customer acceptance |
| Scheduling/webhooks | Scheduler and webhook infrastructure exists in the repository | Do not market as generally live until durable dispatch, authorization and staging acceptance pass |
| Marketplace | Marketplace foundations and payment/verification work exist | Full buyer/creator/payment acceptance remains incomplete |
| Operations | Health/diagnostic and deployment foundations | Production monitoring, recovery drills and customer support acceptance remain open |

### Corrected node inventory

The current `main` test `tests/provider-catalog.test.ts` asserts:

- **122 native executable registry nodes**.
- **100 provider-directory entries**.
- **100 provider entries marked registered; 0 marked coming soon**.
- The executable registry count and provider-directory count are separate measures.

The current `docs/NODE_INVENTORY.md` on main still says **118 executable nodes, 98 mapped and 2 coming soon**. That document is stale relative to the test assertion and current registry implementation. PR #207 contains the corresponding inventory correction to 122 / 100 / 100 / 0.

Important: even 100 registered provider entries do **not** mean 100 authenticated live integrations. Registration, schemas and worker mappings are not proof of OAuth consent, workspace credentials, provider permissions, production allowlisting, real provider success or customer acceptance.

## 2. Current open implementation branches

The following PRs were open at the snapshot. None of their changes should be counted as shipped on main.

| PR | Scope | Branch state | Exact-head automated evidence at snapshot | What remains |
|---|---|---|---|---|
| [#207 Product core](https://github.com/veerex758/Ai-automation/pull/207) | Graph edges/conditions, registry-driven builder and activation, durable worker lease/cancellation, signed webhook queue, read-only agent tools, inventory docs | Open, non-draft; targets main | `verify`, MySQL/MongoDB worker adapter integration, and migration replay passed. Supabase Preview skipped. Vercel status failed with build-rate-limit/upgrade response. | Authenticated staging/browser acceptance, Supabase branch acceptance, live provider tests and final deployment |
| [#208 SaaS platform](https://github.com/veerex758/Ai-automation/pull/208) | Billing/usage, dashboards, workspace roles/invitations, operational alerts and diagnostics | Open draft; targets main | `verify`, MySQL/MongoDB worker adapter integration, and migration replay passed. Supabase Preview skipped. Vercel status failed with build-rate-limit/upgrade response. | Keep draft until exact-head review, migration/staging acceptance and real billing-provider tests |
| [#209 Marketplace](https://github.com/veerex758/Ai-automation/pull/209) | Verification, staged install/update/rollback lifecycle, checkout safety foundations | Open, non-draft; targets main | Migration replay and database adapter integration passed; `verify` failed. Supabase Preview skipped. Vercel status failed with build-rate-limit/upgrade response. | Fix failed verification, rerun exact-head CI, staging/browser acceptance and provider sandbox tests |
| [#210 Recurring billing and invoices](https://github.com/veerex758/Ai-automation/pull/210) | Stripe recurring billing, Paystack recurring authorization/renewal, tax invoice foundations | Open draft; stacked on #208 | Migration replay and database adapter integration passed; `verify` failed. Supabase Preview skipped. Vercel status failed with build-rate-limit/upgrade response. | Fix failed verification; provider sandbox, legal/tax configuration, retry/recovery and staging acceptance |
| [#211 Rexnora brand system](https://github.com/veerex758/Ai-automation/pull/211) | Obsidian/slate/charcoal visual system, restrained blue/lavender accents, silver R mark, product naming/metadata | Open, non-draft; targets main | Exact-head check result was not available from the queried check endpoint at snapshot. | Verify CI and preview; merge before claiming the new brand is consistently shipped |

**Dependency warning:** PR #210 targets PR #208's branch, not main. Treat it as dependent work. Do not merge it directly into main or evaluate it as an independent main-ready change.

**Deployment warning:** the Vercel check on the listed PR heads returned a build-rate-limit/upgrade response. This is a deployment blocker, not evidence that the application code itself failed its GitHub test suite. A GitHub CI pass does not replace a deployable preview.

## 3. CI and deployment evidence

### Main

At the main SHA listed above:

- `verify`: passed on 2026-11-10.
- `workflow-lifecycle`: skipped on 2026-11-11.
- `Supabase Preview`: skipped on 2026-11-14 because the branch was not associated with a Supabase branch.

### Open PRs

- #207: three GitHub Actions jobs passed; Supabase Preview skipped.
- #208: three GitHub Actions jobs passed; Supabase Preview skipped.
- #209: verification failed; database adapter integration and migration replay passed; Supabase Preview skipped.
- #210: verification failed; database adapter integration and migration replay passed; Supabase Preview skipped.
- #211: check evidence was not retrievable for the queried head SHA during this snapshot.

The Vercel status on PR #207–#210 reported a build-rate-limit/upgrade response. Therefore, do not claim these branches have a successfully deployed preview based solely on their GitHub Actions results.

## 4. Customer-pilot readiness: real-estate lead qualification

The first commercial proof should be one narrow workflow, not the full integration catalogue.

**Target outcome:** capture a real-estate enquiry, qualify it with Gemini, send a concise summary through Resend to the authorized agency recipient, and record the outcome so the agency can see the value.

| Gate | Required evidence | Current status |
|---|---|---|
| Lead intake | Authenticated, workspace-owned source; validated payload; duplicate protection | Foundation exists; exact customer path needs staging acceptance |
| AI qualification | Gemini configured; approved prompt/data policy; bounded input/output; failure handling | AI foundation exists; exact end-to-end customer path not yet evidenced |
| Notification | Workspace-approved Resend connection or approved pilot credential; recipient authorization; explicit activation | A Resend send test was reported by the project owner; per-customer workflow acceptance remains outstanding |
| Outcome record | Persist lead/run status, qualification result, notification outcome and timestamps | Persistence foundations exist; confirm exact pilot reporting path |
| Safety | Dry-run first, explicit activation, kill switch, idempotency and sanitized logs | Guard foundations exist; exact path must be tested end to end |
| Commercial proof | Agency operator observes successful runs and confirms time saved/lead response improvement | Not yet evidenced |

**Pilot rule:** do not call this a production lead-management product until the exact real-estate flow has passed authenticated staging acceptance, including one successful run and at least one controlled failure/retry test.

## 5. Marketplace and monetization boundary

Marketplace work is not a blocker for the first real-estate pilot. Keep it separate from the immediate customer-acquisition objective.

The current marketplace and payment branches still require exact-head checks, provider sandbox acceptance, signed webhook/ledger validation, migration replay, and authenticated buyer/creator browser tests. Paystack/Stripe code or checkout UI must not be described as live money movement until the relevant provider accounts, credentials, webhooks, compliance checks and settlement/reconciliation path have been verified.

For PR #210 specifically, legal seller identity, tax jurisdiction/rules, renewal failure recovery and customer mandate/cancellation UX are explicit prerequisites before production tax-invoice or recurring-billing claims.

## 6. Documentation corrections required

| Document/problem | Correction |
|---|---|
| `docs/NODE_INVENTORY.md` on main reports 118 / 98 / 2 | Reconcile to tested main registry assertions: 122 / 100 / 100 / 0 |
| Many docs and environment names still say Aivanta | Rename to Rexnora after PR #211 is reviewed and merged; preserve legacy environment variable names until deliberately migrated |
| `docs/ROADMAP.md` describes the older narrow Resend/manual-trigger execution boundary | Reconcile against current main and the final merged worker/runtime implementation; do not copy branch claims into main docs |
| Historical engineering and staging audits | Keep historical dates and SHA references; add a current status rather than silently treating old snapshots as current |
| Integration inventory language | Always distinguish directory listing, registered node, worker mapping, provider credential verified, live provider verified and customer accepted |

## 7. Recommended delivery order

This order prioritizes customer proof and reduces parallel unfinished work.

1. **Close the product-core path (#207).** Review the exact diff, resolve any remaining CI annotations, obtain an available protected preview, and complete authenticated graph save/reload, Gemini draft generation, dry-run, activation, worker cancellation, signed webhook and workspace-isolation tests.
2. **Prove one real-estate pilot.** Use one controlled agency/test workspace. Verify lead intake → Gemini qualification → Resend notification → persisted outcome. Capture sanitized evidence and measure successful runs.
3. **Resolve deployment capacity.** Restore a usable Vercel preview/build path. Do not use an old deployment SHA as proof for current main or PR heads.
4. **Ship the Rexnora identity (#211).** Verify the visual system and logo across mobile/desktop pages, then merge and deploy.
5. **Complete SaaS billing/operations (#208) only after the product-core dependency and migration plan are clear.** Verify usage reservations, roles, RLS, alerts and billing in staging.
6. **Finish marketplace (#209) and recurring billing (#210) after the core pilot.** Fix failing verification and obtain provider sandbox, finance/legal and browser acceptance before launch claims.

## 8. Release gates — definition of done

Rexnora should not be called generally production-ready until all of the following are recorded against exact commit SHAs:

- [ ] All intended PRs reviewed, correctly based and merged in dependency order.
- [ ] Exact-head lint, type-check, tests and production build pass.
- [ ] Clean isolated migration replay and database integration pass.
- [ ] Supabase staging branch/migration state is healthy and reconciled.
- [ ] Protected Vercel preview deploys from the exact accepted SHA.
- [ ] Authenticated browser tests pass for sign-in, workspace isolation, builder, save/reload, AI draft review and run history.
- [ ] Real-estate pilot flow passes with authorized test credentials and explicit activation.
- [ ] Controlled provider failure, retry/idempotency, cancellation and off-switch tests pass.
- [ ] Logs, usage metering, alerting, backup and recovery expectations are accepted.
- [ ] Customer/operator confirms the pilot outcome; only then expand provider coverage.

## 9. Evidence and interpretation notes

- This report is a repository and CI evidence snapshot dated 2026-11-14 UTC.
- The main SHA is `b2ed613bd9e2f3762fd485e1dbe688af015c412a`; PR head SHAs and job outcomes are recorded in the repository's pull requests and CI.
- The 122-node figure is grounded in the main-branch test assertion in `tests/provider-catalog.test.ts`, not the stale 118-node prose in `docs/NODE_INVENTORY.md`.
- A test passing against MySQL/MongoDB TLS containers is adapter integration evidence, not proof that a customer's production database account is connected.
- A skipped Supabase Preview job is not a pass.
- A Vercel build-rate-limit status is a deployment-capacity failure, not a successful preview.
- No production migration, production environment change, live payment, payout, or deployment was performed to create this report.

**Bottom line:** Rexnora has enough foundation to pursue a tightly controlled design-partner pilot, but the immediate milestone is not “100 integrations” or “marketplace complete.” It is one complete, observable, recoverable real-estate lead workflow that a real agency can use and verify.
