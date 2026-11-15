# Rexnora Release Evidence Log

Updated: 2026-11-15
Owner: Lead Engineering
Authoritative plan: `docs/REXNORA_99_READINESS_ROADMAP.md`

## Current release baseline

- Main SHA: `d47c27e731ea12989b2437fc69d3a3a0e6fb62dc`
- Roadmap audit baseline SHA: `b2ed613bd9e2f3762fd485e1dbe688af015c412a`
- Product-core branch: `fix/product-core-ai-draft-canvas`
- Product-core PR: #207
- Current PR #207 head at this update: `a588e67c3c4e4ae767417de7624554a7f071d6c6`
- No PR has been merged as part of this work session.

## Stage 0 — Re-baseline and PR triage

Status: Passed for repository inventory and PR disposition. The evidence log is now established. Stage 0 does not authorize merging any PR.

| PR | Exact-head state | Disposition |
|---|---|---|
| #207 Product core | CI, Supabase migration replay and database service integration are running on the current head | Continue Stage 1; no merge until all checks and staging gates pass |
| #211 Rexnora branding | Open; CI failed on head `b9fb72ce67129616e2f58c8904ff4c17b74a0fef`; database service integration passed | Leave branding changes to the parallel branding work; reconcile overlapping files at integration |
| #208 SaaS foundations | Open; CI, migration replay and database service integration passed on `a00614ec462454119c807674996edbb31fe8ec50` | Defer until #207 is accepted and merged |
| #209 Marketplace | Open; CI failed on `a141ff9d3402bd4b82d68eb3a8d1ab9f53b51ef0`; migration replay and database service integration passed | Defer; fix CI and wait for prerequisites |
| #210 Recurring billing | Open; CI failed on `d78b16780cb6b566b0480cedf189a504c77423f8`; migration replay and database service integration passed | Defer; depends on #208 |
| #212 Delivery ledger | Open; CI and database service integration passed on `0908e7ed2f0b32bdfc551e23180694699b819a54` | Reconcile against roadmap already merged through #213; do not merge blindly |

## Stage 1 — AI-generated workflows are real graphs

Status: In progress. Code-level blockers found during review have been addressed on #207; automated and authenticated staging acceptance is still pending.

### Changes made on the #207 branch

- Registry-mode generation now requires an explicit `edges` array. Missing connection lists are rejected rather than converted into a placeholder trigger-only graph.
- Server generation validates registered operation IDs, operation input schemas, graph connectivity, branch sources and conditional branch paths.
- Workflow generation is locked to Gemini and requires `GEMINI_API_KEY`. Legacy `AIVANTA_AI_PROVIDER` settings cannot redirect generation to OpenAI; there is no OpenAI fallback.
- Draft validation now validates the registry graph and registered operation schemas before reporting success.
- The unified safe-test endpoint executes saved `aivanta-registry-v1` steps with bounded sample trigger input; it does not call external providers.
- IF and Switch conditions are evaluated during dry-runs. The manual trigger now preserves sample payload for downstream references.
- Activation now requires a successful dry-run of the exact saved version with explicit `registry-v1` evidence for every registered step; older legacy dry-runs cannot satisfy the gate.
- A duplicate registry-run endpoint was removed so the builder uses one safe-test path and the durable dispatch path remains the live execution route.
- Tests were added for missing graph edges, Gemini provider precedence, IF branch selection from sample input, registry dry-run persistence and activation evidence.

### Exact-head automated checks

- Current #207 head: `a588e67c3c4e4ae767417de7624554a7f071d6c6`.
- CI run `43723421651`: in progress at last check.
- Supabase migration replay run `43723421676`: in progress at last check.
- Database service integration run `43723421667`: pending at last check.
- Earlier successful checks on prior SHAs are not evidence for this head.

### Preview and staging evidence

- Vercel project: `ai-automation` (`prj_zsRiRDLRTS22u3ygmuF1hdu7IMmm`).
- Preview environment variable names include `GEMINI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, Supabase service credentials and the live-execution controls. Secret values were not retrieved or recorded.
- No Vercel deployment was found for the current #207 head at the time of this update.
- Authenticated staging checks for prompt → Gemini → graph → edit → save → reload → safe test → activation have not yet been completed.
- Runtime provider evidence confirming Gemini was used has not yet been captured.

### Stage 1 exit decision

Not passed. Do not merge #207 or advance to Stage 2 until exact-head CI, migration replay and database integration pass; a preview is deployed from the exact head; authenticated staging proves graph generation, save/reload, branch execution and safe activation; and runtime evidence confirms Gemini.

## Stage 2 and later

Not started. Follow the stage order in `docs/REXNORA_99_READINESS_ROADMAP.md`. Do not start SaaS, marketplace or broad integration expansion ahead of the Stage 1 and Stage 2 exit gates.

## Update protocol

For every update, record the exact branch SHA, workflow run IDs and conclusions, preview URL, authenticated staging evidence, provider sandbox evidence, blockers and the explicit stage exit decision. Never promote an older SHA's result to a newer commit.