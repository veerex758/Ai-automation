# Rexnora Release Evidence Log

Updated: 2026-11-15
Owner: Lead Engineering
Authoritative plan: `docs/REXNORA_99_READINESS_ROADMAP.md`

## Current release baseline

- Current main SHA: `d47c27e731ea12989b2437fc69d3a3a0e6fb62dc`.
- Roadmap audit merge base: `b2ed613bd9e2f3762fd485e1dbe688af015c412a`.
- Product-core branch: `fix/product-core-ai-draft-canvas`.
- Product-core PR: #207.
- Current PR #207 head: `3ac8a62d4d354dbb3425679ed6d8da25d3b7509c`.
- PR #207 is two commits behind current main. The two commits on main add the authoritative roadmap file; comparison shows no product-code file overlap. Reconcile branch ancestry before merge; do not treat branch drift as resolved.
- No PR has been merged as part of this work session.

## Stage 0 — Re-baseline and PR triage

Status: Passed for repository inventory and PR disposition on 2026-11-15. The detailed current-main/PR table is recorded in PR #214: https://github.com/veerex758/Ai-automation/pull/214. Stage 0 does not authorize merging any PR.

Current dispositions:
- #207 Product core: active first priority; exact-head CI, Supabase replay, database integration and Vercel preview now pass.
- #211 Rexnora branding: independent parallel workstream; latest observed CI and database-service integration passed. Keep branding changes separate from #207.
- #208 SaaS foundations: CI, Supabase replay and database-service integration passed; defer until core and pilot prerequisites are accepted.
- #209 Marketplace: CI failed two tests; defer and fix after prerequisites.
- #210 Recurring billing: CI failed three tests; stacked on #208; defer until #208 is accepted and this branch is reconciled.
- #212 Readiness docs: CI and database-service integration passed, but its duplicate delivery plan conflicts with the authoritative roadmap; revise before merge.

## Stage 1 — AI-generated workflows are real graphs

Status: In progress. Code-level changes and exact-head automated checks pass. Authenticated staging acceptance and runtime Gemini evidence remain outstanding.

### Changes made on the #207 branch

- Registry-mode generation requires explicit graph edges; missing connection lists are rejected rather than converted into a placeholder trigger-only graph.
- Server generation validates registered operation IDs, operation input schemas, graph connectivity, branch sources and conditional branch paths.
- Workflow generation is locked to Gemini and requires `GEMINI_API_KEY`. Legacy provider overrides cannot redirect workflow generation to OpenAI; there is no OpenAI fallback.
- Draft validation checks registry graph structure and operation schemas before reporting success.
- The unified safe-test endpoint executes saved `aivanta-registry-v1` steps with bounded sample trigger input; it does not call external providers.
- IF conditions are evaluated during dry-runs; sample trigger payload is passed to downstream references.
- Activation requires a successful dry-run of the exact saved version with explicit `registry-v1` evidence for every registered step.
- The duplicate registry-run implementation was removed; the legacy endpoint remains a compatibility alias to the unified safe-test route.

### Exact-head automated checks

Current PR #207 head: `3ac8a62d4d354dbb3425679ed6d8da25d3b7509c`.

| Check | Run | Result |
|---|---:|---|
| GitHub CI (workflow tests, lint, type-check, production build) | [43726723065](https://github.com/veerex758/Ai-automation/actions/runs/43726723065) | **Passed** |
| Supabase clean migration replay and pgTAP transaction tests | [43726722953](https://github.com/veerex758/Ai-automation/actions/runs/43726722953) | **Passed** |
| MySQL/MongoDB authenticated TLS adapter integration | [43726723043](https://github.com/veerex758/Ai-automation/actions/runs/43726723043) | **Passed** |

Vercel deployment:
- Deployment: `dpl_CcMsQhpx4ZQ2FyTifP4LY9UhBXVw`
- Exact commit: `3ac8a62d4d354dbb3425679ed6d8da25d3b7509c`
- State: **READY**
- Preview: https://ai-automation-10dn7aq8r-veerex-org.vercel.app

### Preview environment and staging evidence

- Vercel project: `ai-automation` (`prj_zsRiRDLRTS22u3ygmuF1hdu7IMmm`).
- Preview environment entries exist for `GEMINI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, Supabase service credentials and live-execution controls. Secret values were not retrieved or recorded; variable presence alone does not prove valid credentials.
- The preview is deployed from the exact PR #207 head.
- Authenticated staging checks for prompt → Gemini → graph → edit → save → reload → safe test → activation have not yet been completed.
- Runtime provider evidence confirming Gemini was used has not yet been captured.
- No real external provider side effect was initiated during this verification.

### Stage 1 exit decision

**Not passed.** Automated checks and exact-SHA preview are ready, but authenticated staging must prove graph generation, edit/save/reload, conditional branch execution, safe test and activation. Capture runtime evidence that Gemini handled the generation request. Do not merge #207 or mark Stage 1 complete before these gates pass.

## Stage 2 and later

Implementation work exists in #207 for durable execution, cancellation, webhook queueing and provider registry behavior, but these stages are **not accepted**. Follow the stage order in `docs/REXNORA_99_READINESS_ROADMAP.md`. Do not treat Stage 1 CI as proof of Stage 2 execution reliability or Stage 3 provider acceptance. Do not start SaaS, marketplace or broad integration expansion ahead of the core and pilot gates.

## Update protocol

For every update, record the exact branch SHA, workflow run IDs and conclusions, preview URL, authenticated staging evidence, provider sandbox evidence, blockers and the explicit stage exit decision. Never promote an older SHA's result to a newer commit.
