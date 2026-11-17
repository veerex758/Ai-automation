# Rexnora engineering baseline — reconciled 2026-11-17

**Purpose:** Current engineering and release-control snapshot following the Stage 0 baseline. This document records repository facts and PR branch relationships; it does not certify product readiness.
**Main baseline SHA:** `44ed4824f7422dacf443ca12f3abfb7bd5b1613a`
**Roadmap:** `docs/REXNORA_99_READINESS_ROADMAP.md` (authoritative staged plan)
**Snapshot date:** 2026-11-17 (UTC)
**Previous baseline:** 2026-11-15 snapshot at `d47c27e731ea12989b2437fc69d3a3a0e6fb62dc`

## 1. Main branch and release constraints

- `main` at `44ed4824f7422dacf443ca12f3abfb7bd5b1613a` is the release source of truth.
- The previous baseline was stale: it named `d47c27e`, while this snapshot is `44ed482`.
- Main advanced by three commits after shared implementation-branch merge base `b2ed613bd9e2f3762fd485e1dbe688af015c412a`: roadmap branch commit `f5e7bbb`, merge of PR #213 (`d47c27e`), and Stage 0 close/reconciliation commit `44ed482`.
- Those three mainline commits modify only `docs/REXNORA_99_READINESS_ROADMAP.md` and `docs/REXNORA_ENGINEERING_BASELINE_2026-11-15.md`. They do not modify application code or migrations.
- PRs #207–#212 remain three commits behind main. Their GitHub mergeability reports currently say mergeable, but that is not equivalent to current-head CI, staging acceptance or semantic compatibility.
- PR #215 is based on current main and is one commit ahead with no mainline drift.
- No open PR is treated as shipped. No merge, production deployment, production migration, secret change or production-data change is authorized by this snapshot.
- A passing check on an older SHA is not evidence for the current PR head. Skipped Supabase Preview checks are not passes.
- No authenticated end-to-end staging acceptance or customer sign-off is recorded in this reconciliation.

## 2. Active pull requests — exact current heads

| PR | Work | Head SHA | Base | Relationship to main | Current exact-head checks | Disposition |
|---|---|---|---|---|---|---|
| #207 | Product core: graph, durable execution, integrations, agents | `8301554ff742b95e2389020e30148d2927dd1acd` | `main` | 189 commits ahead / 3 behind; merge base `b2ed613` | CI verify passed; Supabase migration replay passed; MySQL/MongoDB service integration passed; Supabase Preview skipped | First implementation priority. Reconcile the 3 documentation commits, rerun checks on the resulting head, then complete authenticated staging acceptance. |
| #208 | SaaS foundations: billing, usage, dashboards, workspaces, operations | `a00614ec462454119c807674996edbb31fe8ec50` | `main` | 168 ahead / 3 behind; merge base `b2ed613` | CI verify passed; migration replay passed; DB service integration passed; Supabase Preview skipped | Keep behind #207/core acceptance. Reconcile mainline docs and retest after the branch changes. |
| #209 | Marketplace verification, staged installation and checkout | `94103078741f95949aa9001e8b8f6cb9db616b4b` | `main` | 75 ahead / 3 behind; merge base `b2ed613` | CI verify passed; migration replay passed; DB service integration passed; Vercel Preview Comments passed; Supabase Preview skipped | Defer until core and SaaS prerequisites. Same-file overlap with #207/#208/#211 requires sequential integration review. |
| #210 | Recurring Stripe/Paystack billing and tax invoices | `05b2e88ac02c8683a9ef8cbed92bd3616affd7c0` | `feat/complete-saas-platform` (#208) | 27 commits ahead of #208 head, zero behind its base. Compared with main it inherits #208 and is 3 commits behind. | CI verify failed; migration replay passed; DB service integration passed; Vercel Preview Comments passed; Supabase Preview skipped | Keep stacked on #208. Do not rebase onto main independently or merge before #208. Fix current TypeScript failures before reconsideration. |
| #211 | Rexnora branding and UX | `1e7361ed293a39038cee5db37077f1942acf129f` | `main` | 165 ahead / 3 behind; merge base `b2ed613` | CI verify passed; DB service integration passed; Supabase Preview skipped | Can progress as a separate workstream, but reconcile main and verify the exact preview/mobile experience. |
| #212 | Duplicate readiness plan and delivery ledger | `0908e7ed2f0b32bdfc551e23180694699b819a54` | `main` | 2 ahead / 3 behind; merge base `b2ed613` | CI verify passed; DB service integration passed; Vercel Preview Comments passed; Supabase Preview skipped | Do not merge as-is. Its second 99% plan duplicates the authoritative roadmap. Salvage only non-conflicting evidence if needed. |
| #215 | Track live Phase 5 entitlement hardening repair | `f089ff0672c409e56e6983ac505bed13cf160a04` | `main` | 1 ahead / 0 behind; merge base is current main | CI verify passed; migration replay passed; DB service integration passed; Supabase Preview skipped | Review migration-history evidence against the connected Supabase database before merging. The migration is already present in the connected project; this PR must not trigger blind reapplication. |

### Check run references

- #207: [verify](https://github.com/veerex758/Ai-automation/actions/runs/43737202136), [migration replay](https://github.com/veerex758/Ai-automation/actions/runs/43737202578), [DB integration](https://github.com/veerex758/Ai-automation/actions/runs/43737202060) — all passed on `8301554`; [Supabase Preview](https://github.com/veerex758/Ai-automation/runs/132882302816) skipped.
- #208: [verify](https://github.com/veerex758/Ai-automation/actions/runs/43594122733), [migration replay](https://github.com/veerex758/Ai-automation/actions/runs/43594122811), [DB integration](https://github.com/veerex758/Ai-automation/actions/runs/43594122727) — all passed on `a00614e`; Supabase Preview skipped.
- #209: [verify](https://github.com/veerex758/Ai-automation/actions/runs/43846238709), [migration replay](https://github.com/veerex758/Ai-automation/actions/runs/43846238689), [DB integration](https://github.com/veerex758/Ai-automation/actions/runs/43846238786) — all passed on `9410307`; Vercel Preview Comments passed; Supabase Preview skipped.
- #210: [verify](https://github.com/veerex758/Ai-automation/actions/runs/43846433070) — failed on `05b2e88`; [migration replay](https://github.com/veerex758/Ai-automation/actions/runs/43846433147) and [DB integration](https://github.com/veerex758/Ai-automation/actions/runs/43846433127) passed; Vercel Preview Comments passed; Supabase Preview skipped.
- #211: [verify](https://github.com/veerex758/Ai-automation/actions/runs/43731368008) and [DB integration](https://github.com/veerex758/Ai-automation/actions/runs/43731368042) passed on `1e7361e`; Supabase Preview skipped.
- #212: [verify](https://github.com/veerex758/Ai-automation/actions/runs/43632430805) and [DB integration](https://github.com/veerex758/Ai-automation/actions/runs/43632430879) passed on `0908e7e`; Vercel Preview Comments passed; Supabase Preview skipped.
- #215: [verify](https://github.com/veerex758/Ai-automation/actions/runs/43734922989), [migration replay](https://github.com/veerex758/Ai-automation/actions/runs/43734922953), [DB integration](https://github.com/veerex758/Ai-automation/actions/runs/43734923000) — all passed on `f089ff0`; Supabase Preview skipped.

## 3. Branch drift and merge-conflict assessment

### Mainline drift

The three commits missing from PRs #207–#212 are documentation-only. The GitHub compare API reports all those PRs as mergeable against current main, so no direct textual merge conflict is currently reported for the mainline documentation delta. Nevertheless, each branch must be updated/rebased or merged with current main and its checks rerun on the resulting SHA before merge.

PR #215 already starts from current main and does not need this reconciliation.

### Shared-file overlaps between active PRs

A shared changed path is a potential integration conflict, not proof of a Git conflict. GitHub currently reports each open PR as mergeable against its declared base, but those individual results do not prove that multiple PRs can be combined without semantic regressions.

| PR pair | Shared changed paths | Main risk |
|---|---:|---|
| #207 / #208 | 9 | Both change workflow/agent APIs and durable worker; #208 depends on the behavior delivered by #207. |
| #207 / #209 | 7 | Both change webhook ingress, live/registry run routes and durable worker; marketplace changes must not overwrite core execution safety. |
| #207 / #211 | 2 | Both change agent and workflow page components; verify branding does not regress graph UX. |
| #208 / #209 | 5 | Both change webhook/run routes, dashboard home and durable worker. |
| #208 / #211 | 4 | Both change workspace integration and billing/dashboard surfaces. |
| #209 / #211 | 19 | Marketplace pages and many customer-facing pages overlap with brand-system changes. |
| #208 / #210 | 75 | Expected stacked relationship: #210 is based on #208 and adds 27 commits / 19 changed files on top of it. Keep this dependency intact. |
| #209 / #210 | 5 | Both touch execution routes and durable worker; integrate only after their respective prerequisites. |

### Required integration order

1. Reconcile #207 to current main and complete its exact-head checks.
2. Integrate and verify #207 before treating #208/#209 as compatible with its final workflow and worker contracts.
3. Keep #210 based on #208; after #208 is accepted, update #210 to the accepted #208 head and rerun all checks.
4. Keep #211 independent where possible; when merging, resolve shared UI files against the latest main rather than blindly accepting either branch's copy.
5. Defer #209 until core execution and SaaS prerequisites are accepted; reconcile its overlapping webhook/worker/UI changes at that time.
6. Do not merge #212 as a second roadmap. #215 requires a database-history review, not a blind migration replay.

## 4. Specific blockers carried forward

- **#207:** All listed CI/replay/DB checks pass on its current SHA, but Supabase Preview is skipped and authenticated staging acceptance remains outstanding.
- **#208:** Automated checks pass on its current SHA, but Supabase Preview is skipped and compatibility with the final #207 core needs verification.
- **#209:** Automated checks pass on its current SHA, but Supabase Preview is skipped; shared execution/UI files make it a later integration.
- **#210:** TypeScript currently fails:
  - `hasWorkspacePermission` is imported from `@/lib/supabase/workspace` but is not exported.
  - Stripe subscription response typing does not expose the accessed `current_period_start` / `current_period_end` fields as used.
  - The current Stripe `Invoice` type does not expose the accessed `subscription` property.
  Resolve types against the installed Stripe SDK/API version; do not silence errors with broad casts.
- **#211:** Automated CI and DB integration pass, but Supabase Preview is skipped and exact-head responsive/browser acceptance is outstanding.
- **#212:** Duplicate roadmap/ledger content is not an acceptable second source of truth.
- **#215:** Its repair migration is present in the connected Supabase project's migration history. Verify the RPC and grants in the actual project; do not blindly apply it again.

## 5. Supabase environment observation

The connected Supabase project discovered during this audit is `uthqrszdtzmicspryxbw` (`supabase-apricot-paddle`), status `ACTIVE_HEALTHY`.

Its migration history includes `20261115161842_aivanta_subscription_entitlement_hardening_repair`. The database contains:
- `consume_workspace_usage(uuid, text, integer, jsonb) returns jsonb`, SECURITY DEFINER, with execute grants to `authenticated` and `service_role`.
- `dispatch_workflow_execution` overloads with and without `p_execution_mode`; both are SECURITY DEFINER and executable by `service_role` (not `authenticated`).

This confirms presence and basic function/grant shape only. It does not prove the UI's usage-metering request succeeds for a signed-in workspace. The runtime error still needs authenticated request tracing and quota behavior tests.

## 6. Stage 0 reconciliation decision

**Stage 0 remains passed as a documentation/release-control milestone, with this 2026-11-17 snapshot superseding the stale 2026-11-15 branch-status table.** The baseline SHA, exact PR heads, branch drift, PR #210 dependency, shared-file overlaps, current exact-head check outcomes and Supabase observation are now recorded.

This does **not** mean implementation branches are reconciled, PRs are ready to merge, staging has passed, or Rexnora is launch-ready.

**Next active engineering stage:** Stage 1 — reconcile and complete PR #207, then verify the generated graph journey in authenticated staging. Keep each later stage's exit evidence separate and do not advance a stage because code was merely written.
