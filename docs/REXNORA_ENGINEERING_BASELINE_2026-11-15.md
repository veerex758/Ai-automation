# Rexnora engineering baseline — 2026-11-15

**Purpose:** Evidence record for completed Stage 0 (re-baseline, PR triage and release control).
**Main baseline SHA:** `d47c27e731ea12989b2437fc69d3a3a0e6fb62dc`
**Roadmap:** `docs/REXNORA_99_READINESS_ROADMAP.md`
**Snapshot date:** 2026-11-15 (UTC)

## Main and release constraints

- Main is the release source of truth at the baseline above. All six implementation/documentation PR branches #207–#212 were compared against this current main SHA.
- No open PR is treated as shipped.
- Vercel preview deployment is currently blocked by the account's daily free-plan deployment limit (`api-deployments-free-per-day`). This is a deployment-capacity blocker, not a GitHub Actions result.
- No authenticated staging acceptance has been completed in this snapshot. Preview deployment must be restored before the Stage 1 browser acceptance gate can pass.
- No production migrations, secrets, or production data were changed as part of this baseline.

## Open pull-request status and disposition

All PRs below were checked against their exact current head SHA. PRs #207, #208, #209, #211 and #212 share merge base `b2ed613bd9e2f3762fd485e1dbe688af015c412a` and are **2 commits behind current main** (`d47c27e`). PR #210 is correctly stacked on #208. GitHub Actions status is recorded independently from Vercel.

| PR | Exact head SHA | Merge base / dependency | GitHub checks at snapshot | Disposition |
|---|---|---|---|---|
| #207 Product core | `3ac8a62d4d354dbb3425679ed6d8da25d3b7509c` | merge base `b2ed613bd9e2f3762fd485e1dbe688af015c412a`; **2 commits behind current main** | CI, Supabase replay and database-service integration running; prior head failed TypeScript on `NextRequest` import and then one whitespace-sensitive test. Both fixes are on this head. | **Active first priority.** Wait for exact-head checks; fix any remaining failures; do not merge before preview and authenticated staging acceptance. |
| #208 SaaS foundations | `a00614ec462454119c807674996edbb31fe8ec50` | merge base `b2ed613bd9e2f3762fd485e1dbe688af015c412a`; **2 commits behind current main** | CI passed; Supabase replay passed; database-service integration passed. Vercel blocked by daily deployment limit. | **Defer** until product core and pilot prerequisites are accepted. |
| #209 Marketplace | `a141ff9d3402bd4b82d68eb3a8d1ab9f53b51ef0` | merge base `b2ed613bd9e2f3762fd485e1dbe688af015c412a`; **2 commits behind current main** | Supabase replay and database-service integration passed; CI failed two tests: marketplace staged update and builder create-vs-patch contract. Vercel blocked. | **Defer/revise** after core and SaaS foundations; fix its exact-head tests before reconsideration. |
| #210 Recurring billing and tax invoices | `d78b16780cb6b566b0480cedf189a504c77423f8` | base branch **#208** at `a00614ec462454119c807674996edbb31fe8ec50`; #208 itself is 2 commits behind current main | Supabase replay and database-service integration passed; CI failed three tests covering billing RLS, Paystack renewal scheduler and Vercel cron target. Vercel blocked. | **Defer.** First accept #208; then reconcile this branch to the accepted base and fix all failures. No live billing/tax claims. |
| #211 Rexnora branding | `e8b58bafdc7bd3d13bafeaf35cbbcc974eb11bc7` | merge base `b2ed613bd9e2f3762fd485e1dbe688af015c412a`; **2 commits behind current main** | CI passed; database-service integration passed; Supabase replay not reported for this head. Vercel blocked. | **Independent parallel workstream.** Branding review and mobile/desktop regression remain separate; do not mix with #207. |
| #212 Readiness docs and delivery ledger | `0908e7ed2f0b32bdfc551e23180694699b819a54` | merge base `b2ed613bd9e2f3762fd485e1dbe688af015c412a`; **2 commits behind current main** | CI passed; database-service integration passed; Vercel passed. | **Revise before merge.** Its dated 99% plan duplicates and conflicts with the now-authoritative roadmap's stage structure. Retain only non-conflicting evidence/ledger material if useful; do not merge the old plan as a second source of truth. |

### Exact-head verification references

- PR #207 CI run: [43726723065](https://github.com/veerex758/Ai-automation/actions/runs/43726723065) — in progress at snapshot.
- PR #207 Supabase replay: [43726722953](https://github.com/veerex758/Ai-automation/actions/runs/43726722953) — in progress at snapshot.
- PR #207 database service integration: [43726723043](https://github.com/veerex758/Ai-automation/actions/runs/43726723043) — in progress at snapshot.
- PR #208 CI / replay / database integration: [43594122733](https://github.com/veerex758/Ai-automation/actions/runs/43594122733), [43594122811](https://github.com/veerex758/Ai-automation/actions/runs/43594122811), [43594122727](https://github.com/veerex758/Ai-automation/actions/runs/43594122727) — passed.
- PR #209 CI: [43623532904](https://github.com/veerex758/Ai-automation/actions/runs/43623532904) — failed two tests; replay [43623532874](https://github.com/veerex758/Ai-automation/actions/runs/43623532874) and database integration [43623532864](https://github.com/veerex758/Ai-automation/actions/runs/43623532864) passed.
- PR #210 CI: [43622991087](https://github.com/veerex758/Ai-automation/actions/runs/43622991087) — failed three tests; replay [43622991099](https://github.com/veerex758/Ai-automation/actions/runs/43622991099) and database integration [43622991198](https://github.com/veerex758/Ai-automation/actions/runs/43622991198) passed.
- PR #211 CI [43723755859](https://github.com/veerex758/Ai-automation/actions/runs/43723755859) and database integration [43723755853](https://github.com/veerex758/Ai-automation/actions/runs/43723755853) passed.
- PR #212 CI [43632430805](https://github.com/veerex758/Ai-automation/actions/runs/43632430805) and database integration [43632430879](https://github.com/veerex758/Ai-automation/actions/runs/43632430879) passed; Vercel deployment passed.

## Stage 0 exit decision

**Passed — 2026-11-15.** The current main SHA, exact PR heads, two-commit branch drift, PR #210 dependency on #208, exact-head check states, deployment blocker and a clear disposition for every open PR are recorded above. Branch reconciliation is an explicit follow-up before any merge; the baseline does not imply branches are current. This is a status/release-control milestone only; it does not mean #207 or the product is ready to merge or launch.

**Next active stage:** Stage 1 — AI-generated workflows must be real graphs. Continue #207 verification and authenticated staging only after a usable preview is available. Keep Stage 2/3 acceptance evidence separate; do not claim those stages passed from CI alone.
