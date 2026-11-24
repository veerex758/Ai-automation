# Rexnora Release Evidence Log

Updated: 2026-11-17
Owner: Lead Engineering
Authoritative plan: `docs/REXNORA_99_READINESS_ROADMAP.md`

## Current release baseline

- Current `main` SHA: `6a5173410adaad3991a32e92a858a4ce164b98e6`.
- PR #216 (baseline reconciliation) was reviewed and squash-merged as `6a5173410adaad3991a32e92a858a4ce164b98e6`; it changed documentation only.
- Product-core branch: `fix/product-core-ai-draft-canvas`.
- Product-core PR: #207.
- Application-code snapshot reviewed: `9a03b7283d085bde07a5264220b3290d418285b9`; the subsequent `f62c2f0` commit refreshed this evidence document only.
- PR #207 is reconciled with current `main` at the SHA above. Its branch was reconciled by a two-parent merge commit preserving the PR tree and taking the authoritative roadmap and baseline documents from main. Check the PR for the live ahead/behind count and latest documentation-only commits.
- PR #207 remains open. No implementation PR has been merged and no production deployment or production migration was performed.

## Stage 0 — Re-baseline and PR triage

Status: Passed as repository inventory and release-control work. The reconciled baseline is recorded in the main-branch `docs/REXNORA_ENGINEERING_BASELINE_2026-11-15.md`. Stage 0 does not certify implementation readiness or authorize production release.

## Stage 1 — AI-generated workflows are real graphs

Status: **In progress; exit gate not yet passed.**

### Implementation and corrections on #207

- Registry-mode Gemini generation returns explicit registered steps and graph edges; missing edge lists, unknown operations, invalid inputs, invalid branch sources, disconnected nodes and cycles are rejected.
- Generated nodes are constructed from the validated registered operation plan and shown on the editable graph canvas; the generated draft is not saved or executed automatically.
- The canvas supports node selection, drag positioning, node configuration, edge editing and conditional true/false connections.
- Conditional graphs are rebuilt into registered execution steps and checked against operation schemas before validation or save.
- Saved registry workflows preserve graph edges, node positions, registered operation IDs, input payloads and conditional branch metadata. The GET path validates the stored registry plan before returning it.
- The workflow GET response now includes the database's current `workflows.version`; the builder displays that exact version and updates it from the save response. The version history endpoint lists immutable snapshots, and restore creates a new version rather than overwriting history.
- Gemini is the deterministic workflow-generation provider. It requires server-side `GEMINI_API_KEY`; legacy OpenAI overrides and an OpenAI-only configuration cannot redirect or silently fall back.
- Successful, validated Gemini generation now emits a safe operational event with request ID, provider and model. Prompt content and credentials are excluded from that log record.
- Safe test runs use saved registry steps and bounded sample input; they are distinct from live provider execution. Generation alone never activates or executes a workflow.
- Activation is still gated by a successful dry-run of the exact saved version and explicit registry execution evidence. Activation/live-execution acceptance belongs to the relevant later execution stage; it is not inferred from Stage 1 source tests.

### Automated checks for the application-code snapshot

Application-code snapshot: `9a03b7283d085bde07a5264220b3290d418285b9`. The later `f62c2f0` commit changes only this evidence document; it does not change application code.

| Check | Run | Current result |
|---|---:|---|
| GitHub CI — workflow tests, lint, type-check, production build | [44169537018](https://github.com/veerex758/Ai-automation/actions/runs/44169537018) | In progress at this evidence update |
| Supabase clean migration replay and pgTAP tests | [44169537072](https://github.com/veerex758/Ai-automation/actions/runs/44169537072) | In progress at this evidence update |
| MySQL/MongoDB authenticated TLS adapter integration | [44169537047](https://github.com/veerex758/Ai-automation/actions/runs/44169537047) | In progress at this evidence update |

Earlier runs on the reconciled pre-fix commit `cec0098f68843e7b416e7681ddfe9e6584795c06` are not promoted to this latest SHA: migration replay and DB integration passed there, while CI was still building. The original `8301554` checks are older still.

### Supabase environment inspection

- Connected project: `uthqrszdtzmicspryxbw` (`supabase-apricot-paddle`), status `ACTIVE_HEALTHY`.
- Read-only inspection confirms `consume_workspace_usage(uuid, text, integer, jsonb) returns jsonb` exists with execute grants for `authenticated` and `service_role`.
- Read-only inspection confirms `save_workflow_definition(uuid, jsonb)` is an invoker function with authenticated/service-role execute grants. Its private save helper verifies authentication and workspace membership, increments `workflows.version`, and inserts the matching `workflow_versions` snapshot in the same transaction.
- These database facts do not replace an authenticated request against the preview environment. The known usage-metering runtime error still needs to be tested from the signed-in UI; do not blindly reapply an existing migration.

### Preview and staging evidence

- Vercel project: `ai-automation` (`prj_zsRiRDLRTS22u3ygmuF1hdu7IMmm`).
- Preview deployment for application-code snapshot `9a03b7283d085bde07a5264220b3290d418285b9`: `dpl_EHvwpvcWs1CbGbivsDbvCe5zNB6z`, state **READY**. URL: https://ai-automation-579i1w8td-veerex-org.vercel.app
- The later `f62c2f0` evidence-document commit has its own preview queued; it contains no application-code changes. Use the READY application-code preview above for Stage 1 UI checks.
- Preview environment entries for Gemini and Supabase were previously observed, but secret values were not retrieved. Presence does not prove the Gemini key is valid or that the preview is connected to the intended database.
- No authenticated staging test has yet captured prompt → Gemini → valid graph → canvas edit → save → reload of the same version.
- No runtime success log from the new Gemini provider/model evidence path has yet been captured.
- Conditional branch execution has not yet been demonstrated in authenticated staging.
- No external provider side effect or production change was initiated during this verification.

### Stage 1 exit decision

**Not passed.** The code-level graph, canvas, persistence and exact-version reporting changes are implemented, and exact-head checks are running. The required preview is still queued, so authenticated staging cannot yet prove Gemini generation, branch save/reload and controlled branch execution. Do not merge #207 or mark Stage 1 complete until the current SHA has passing required checks and the authenticated staging evidence above is captured.

## Stage 2 and later

Durable execution, cancellation, webhook queueing, agent boundaries, provider integrations and activation foundations exist in #207 but are not certified by Stage 1. Continue in the roadmap's order. Do not treat Stage 1 checks as proof of Stage 2 execution reliability, Stage 3 provider acceptance or Stage 4 real-estate pilot value.

## Update protocol

For every update, record the exact branch SHA, workflow run IDs and conclusions, preview URL/state, authenticated staging evidence, provider evidence, blockers and explicit stage exit decision. Never promote an older SHA's result to a newer commit.


---

## 2026-11-20 verification refresh

This section supersedes earlier status statements above where they conflict with the live GitHub/Vercel/Supabase inspection below. The authoritative delivery sequence remains `docs/REXNORA_99_READINESS_ROADMAP.md`.

### Exact repository and PR state

- Repository: `veerex758/Ai-automation`.
- `main` SHA at inspection: `92716c5546117ba337717c0d83c7a1719355c88f`.
- PR #207 branch: `fix/product-core-ai-draft-canvas`.
- PR #207 code head inspected: `2f70263b110627c7ea396dc3c0c06dca73ea89aa`.
- GitHub compare: 262 commits ahead of `main`, zero behind; merge base equals the inspected `main` SHA.
- PR remains open and GitHub reports it mergeable. This is not merge authorization.

### Exact-head automation

The following GitHub Actions runs are associated with the inspected PR head and all completed successfully:

| Workflow | Run ID | Result |
|---|---:|---|
| CI / verify | 44627000066 | Passed |
| Real MySQL and MongoDB worker adapters | 44626999641 | Passed |
| Supabase migration replay | 44626999678 | Passed |

These are clean migration replay and database-service integration checks. They do not establish that the connected Supabase project's migration history is fully reconciled or that authenticated staging acceptance has passed.

### Preview deployment

- Vercel project: `ai-automation` (`prj_zsRiRDLRTS22u3ygmuF1hdu7IMmm`).
- Deployment: `dpl_9yTqBPVo35p68rU73JdbgmecknFM`.
- Commit: `2f70263b110627c7ea396dc3c0c06dca73ea89aa`.
- State: **READY**.
- Preview: https://ai-automation-51qymgg0x-veerex-org.vercel.app
- Git alias: https://ai-automation-git-fix-product-core-ai-draft-canvas-veerex-org.vercel.app

READY confirms the deployment completed; it does not prove signed-in UI behavior or provider credentials are valid.

### Connected Supabase migration-history audit (read-only)

- Connected project: `uthqrszdtzmicspryxbw` (`supabase-apricot-paddle`), status `ACTIVE_HEALTHY`.
- The PR's migrations `20261114072354`, `20261114072358`, `20261114072907`, `20261114073109` and `20261114074228` are recorded in the connected project's migration history.
- The newer PR migration `20261117190000_rexnora_dry_run_dead_letter_recovery.sql` is **not recorded** in that project's migration history.
- Read-only catalog checks found the cancellation and execution-mode columns, error-event and rate-limit tables, and the expected service-role-only cancellation/dispatch/finalization RPC signatures. The new `execution_dead_letter_recoveries` table is absent, consistent with the unrecorded migration.
- Relevant RPC execute privileges observed: `service_role` can execute; `authenticated` and `anon` cannot.
- No migration was applied or modified during this inspection. Do not blindly apply the missing migration; first confirm the preview's intended database/environment and use the authorized migration/release procedure.

### Stage 1 exit decision

**Still not passed.** The current code head has passing CI, database integration, clean migration replay and a READY preview. Remaining required evidence:

1. Sign in to the exact preview and capture prompt → Gemini → valid graph generation.
2. Edit the generated graph, save it, reload it, and confirm the same workflow version and graph structure.
3. Save/reload a conditional graph and demonstrate the expected branch in a controlled test.
4. Capture runtime evidence that Gemini was the provider used.
5. Confirm generation alone does not activate or execute the workflow.

No merge, production deployment, production migration or live external side effect was performed. Stage 2 and later gates remain separate and are not certified by this refresh.

### 2026-11-20 authenticated user screen-recording follow-up

- User-provided recording shows the AI-generated five-node workflow opened in the Workflow Builder as **Draft · v1**. The canvas displayed 5/30 steps, including a webhook trigger, lead qualification, an IF condition and two downstream actions. This is evidence that the initial assistant-to-builder draft creation and definition fetch worked on the tested preview session.
- Vercel runtime event at `2026-11-20T10:22:39.726Z` on deployment `dpl_G7Jt9Hv98wQ9cXWeR5VeN3kJf6M1` recorded a successful `POST /api/ai/generate-workflow`: provider `gemini`, model `gemini-3.5-flash-lite`, `fallbackUsed: true`, status 200. This confirms generation used the bounded Gemini fallback model for that request.
- The recording then shows node layout edits and the Builder's **Unsaved changes** state. At approximately 36 seconds, clicking **Validate draft** displayed: “Step settings contain an unsupported field or an invalid value.” The recording does not show a successful Save workflow action or a refresh/reload after those layout edits. Therefore the initial draft exists as v1, but persistence of the subsequent edits remains unverified.
- Code inspection found the round-trip defect: the workflow-definition GET response was injecting registry `provider` and `operation` fields into every node's legacy `settings` object. Those keys are invalid for trigger and condition node settings and caused the validator error on reload. The metadata is now returned separately as `registryNodeId`, `registryOperationId` and `registryInput` in commit `e795a60900369411ee7771b0d71e400b91474b3d`; tests assert that it does not contaminate the settings schema.
- A validator regression test using a trigger, IF node and true/false action branches was added in commit `51a433872e14a6037f36c226716453654dea1055`.
- The earlier creation-path correction remains in commits `4ba430616056f806ce3befe33978aa32175aa923` and `8f7afe9c36baf5ad1e222dd19e0b42948bf84769`: insert an empty workflow row, then persist the validated graph through `save_workflow_definition`; clean up the just-created row if the RPC fails.
- Signup redirect observation: deployed signup code sets `emailRedirectTo` to `window.location.origin/auth/callback?next=/dashboard`. The recording's confirmation link opened `localhost:3000`, which was refused. The connected Vercel environment inventory has no `NEXT_PUBLIC_SITE_URL` variable. The actual Supabase Auth Site URL, Redirect URLs allowlist and confirmation-email template were not accessible for inspection; check that the stable Rexnora URL / preview pattern is allowed, the Site URL is not localhost, and the email template uses the requested redirect target.
- Latest PR #207 head at this update: `51a433872e14a6037f36c226716453654dea1055`. Latest Vercel deployment and exact-head checks are pending at the time of this update.
- Stage 1 remains **not passed** until the latest exact-head checks pass and the authenticated preview proves: validate succeeds, save succeeds, reloading preserves the same version/graph structure, and conditional branches survive save/reload and a controlled test. Generation alone remains review-only; do not activate the workflow during this test.


### 2026-11-20 visual graph UX implementation follow-up

- PR #207 branch now adds a dedicated canvas camera: wheel zoom, pointer/touch background panning, zoom-in/out controls, zoom percentage and Fit-to-view.
- Node dragging is scale-aware so node coordinates move by the correct graph-space distance at any zoom level.
- Registry-backed nodes display provider-specific glyphs and provider names, while retaining trigger/action/condition identity and operation labels.
- Gemini-generated graphs are positioned left-to-right. IF true/false routes are arranged in distinct upper/lower lanes; later actions inherit their branch lane. Layout resolution follows graph dependencies rather than relying on the model's step-list ordering.
- Manually created nodes receive graph-derived positions. Connecting a condition branch clears the destination's stale fixed position so it can be laid out on the selected branch lane.
- Saving now resolves and persists an explicit position for every canvas node, including nodes never manually dragged. The saved client fingerprint uses that same normalized graph; the GET path already restores positions and explicit edges.
- Focused regression assertions were added for graph zoom/pan, provider glyphs, branch-aware layout, direct AI-to-canvas routing and persistence of all node coordinates.
- Relevant commits: `258beec` (camera, scale-aware drag and position persistence), `5e2571d` (navigation controls/styles), `e11b79e` and `374402f` (dependency-based layout and branch placement), `a912ec3` (provider glyphs), `99e23c7` (fix default export after initial preview syntax failure), and `68fdf13` (final glyph assertion correction).
- An intermediate preview for `27300ce` failed because the provider-glyph helper was inserted after the `export default` token. The export placement was corrected in `99e23c7`; that corrected build was still running at this evidence update.
- Latest branch head at this update: `68fdf139ac18c6dadf159a598aaa50bae3ce22a4`. Vercel preview deployment for this exact head is queued: https://ai-automation-17h7nhndq-veerex-org.vercel.app
- No authenticated browser acceptance has yet been completed for zoom, pan, node configuration, branch placement or save/reload on the latest preview. Stage 1 remains **in progress**; the preview build and all authenticated staging checks must pass before Stage 1 can be marked complete. No workflow was activated or executed by these changes.


### 2026-11-20 branded node renderer completion pass

- The workflow canvas now uses a reusable `GraphNodeBrand` renderer rather than generic text glyphs for registered integrations.
- The official integration logo catalogue was moved to `lib/integrations/official-brand-assets.ts` and is shared by both the Integrations directory and the workflow canvas. It currently contains 86 mapped provider marks, including Gmail, Google Sheets, Slack, Gemini, Resend, Notion, HubSpot, Salesforce, GitHub, Supabase, PostgreSQL, MySQL, MongoDB, Redis and additional catalogue entries.
- Brand artwork is loaded from the same Simple Icons CDN already used in the Integrations directory, with provider-specific tints. Failed image loads fall back to native in-app SVG marks / primitive marks; no broken-image box is left on the canvas. The registered Email node is labelled with the Resend brand mark.
- Canvas nodes now use compact square logo tiles with visible input/output ports. The operation name appears directly beneath each tile, with the provider name as secondary caption. Selecting a node still opens the existing configuration inspector.
- Webhook, email, IF/condition, schedule, manual trigger, HTTP, database and code primitives have purpose-built vector marks where they are native workflow primitives rather than third-party brands.
- Edge geometry now terminates at the square tile's input/output ports. Connections use smooth curves; TRUE and FALSE branches have visible labels, distinct green/amber path and matching arrowheads (FALSE is dashed).
- Fit-to-view now calculates the actual visible node bounds rather than fitting the unused 1000×680 canvas minimum. This improves node size on a narrow phone viewport. Wheel zoom, zoom buttons, background drag-to-pan, scale-aware node drag and explicit coordinate persistence remain in place.
- Focused source-contract tests now cover the shared provider catalogue, major brand mappings, image-load fallback, compact tiles, operation captions, ports, branch path/arrow styling and content-aware fit. Existing save/reload graph persistence tests remain in place.
- Latest implementation commits include: `3350e0a` (first brand component), `1c03260` (canvas renderer), `43182ae` (compact node CSS), `cb35e13` / `37d71c6` (fit actual node bounds), `9769305` (native SVG primitives), `0da1733` / `2d2f4a4` / `a4e0e9e` (single shared provider logo source), `ee0282a` / `c0249e9` (colored branch arrowheads), and `a4cc1fb` / `f63350d` (regression checks and safe logo dragging).
- The external Simple Icons CDN is intentionally consistent with the existing Integrations directory. Native/fallback marks are used when a provider has no official asset mapping or the remote SVG cannot load.
- Release boundary: this change only affects the draft graph presentation/editor. Generation remains review-only; nothing in the renderer activates or executes workflows. PR #207 remains open and no production deployment or database migration was performed.
- Authenticated visual acceptance remains required: on the latest preview, inspect Gmail/Google Sheets/Slack/Gemini and database marks on a real generated graph; exercise input/output connections and both condition branches; drag, zoom and pan on mobile; save, reload and confirm positions/edges remain identical. Do not mark Stage 1 passed until that test and exact-head checks pass.


### 2026-11-20 AI graph semantic fidelity guard

- Investigation of the generated Gmail → Gemini → IF → Google Sheets/Slack draft showed that a syntactically valid graph can still misrepresent the requested business behavior.
- Registry audit confirmed Gmail currently exposes read actions (`list_messages`, `get_message`) and no Gmail trigger. Google Sheets currently exposes read operations only; no append/write operation is registered. Slack exposes registered message-sending actions, and Gemini exposes registered lead-qualification.
- Added `lib/workflows/ai-request-capability-guard.cjs` and wired it before the Gemini provider call and before usage consumption. Requests requiring an unavailable Gmail new-email trigger or Google Sheets write operation now return HTTP 422 with `AI_UNSUPPORTED_CAPABILITY` and an actionable explanation; no Gemini request is made and no AI credit is consumed.
- Strengthened Gemini registry-planning instructions: use exact requested provider operations, never substitute generic HTTP/internal actions for a missing named integration, avoid speculative/duplicate fetch steps, require Gmail List messages → Get message → downstream processing when those read steps are used, and keep edges aligned with upstream data dependencies without cycles or backward links.
- AI Assistant now displays a specific title for unsupported requested capabilities instead of a generic generation failure.
- Added CI-covered tests for unsupported Gmail triggers, missing Sheets write operations, supported Gmail/Gemini/Slack combinations, and allowing requests once the missing capabilities are genuinely registered.
- This is a fail-closed correctness improvement, not a claim that Gmail event triggers or Google Sheets writes have been implemented. To generate the exact requested workflow, Stage 3 integration work must add and test those operations (including secure Gmail polling/event semantics, deduplication/checkpointing, Sheets write scopes and append behavior). Do not fake these with HTTP nodes.
- No workflow was activated or executed; no database migration or production change was made. Stage 1 remains in progress pending exact-head CI and authenticated preview acceptance.
