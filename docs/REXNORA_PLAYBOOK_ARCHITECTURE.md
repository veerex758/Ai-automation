# Rexnora Playbook Architecture

**Status:** Canonical product and implementation contract, version 1  
**Scope:** First commercial vertical — real-estate enquiry qualification  
**Execution boundary:** This document does not authorize live execution or production changes.

## Product decision

A Playbook represents one business outcome, not a canvas or an arbitrary collection of nodes. The first Playbook is **Qualify property enquiries**.

The business owner configures the outcome, rules, action permissions and review behavior in plain language and structured controls. The visual graph remains an advanced/internal representation of the same saved definition; it is not the primary product experience.

## Existing foundation to reuse

The integration branch already contains:
- Workspace-scoped workflow definitions and version snapshots.
- A registered-operation catalog, graph validator and runtime planner.
- Workflow run and step history.
- Real-estate leads, explainable deterministic lead scores, consent records, lead activities, intake forms, approved agency alert recipients, and a durable follow-up queue.
- A durable Gemini qualification and Resend alert pipeline with workspace connection checks, operation approvals, retries and notification idempotency.

Do not introduce parallel CRM, workflow, run-history or provider-credential stores. Extend these foundations.

## Canonical definition envelope

The canonical Playbook is stored inside the existing versioned workflow definition:

~~~json
{
  "version": 1,
  "nodes": [],
  "edges": [],
  "format": "aivanta-registry-v1",
  "steps": [],
  "playbook": {
    "schema": "rexnora.playbook",
    "schemaVersion": 1,
    "goal": {
      "industry": "real_estate",
      "outcome": "Qualify property enquiries and route the correct next action."
    },
    "rules": [
      {
        "id": "high-intent",
        "nodeId": "if-high-intent",
        "name": "High-intent enquiry",
        "rationale": "Give urgent, well-qualified enquiries priority."
      }
    ],
    "actionPolicies": [
      {
        "stepId": "qualify",
        "nodeId": "gemini",
        "operationId": "qualify_real_estate_lead",
        "permission": "auto"
      },
      {
        "stepId": "notify",
        "nodeId": "email",
        "operationId": "send_email",
        "permission": "ask_first"
      }
    ],
    "review": {
      "confidenceThreshold": 0.8,
      "reviewMissingFields": true,
      "reviewWhenNoRuleMatches": true,
      "reviewProviderFailures": true
    }
  }
}
~~~

The graph is the only source of truth for condition predicates and edges. A Playbook rule labels one existing condition node; it must not copy the predicate into a second format. Every executable action step except the deterministic IF evaluator must have exactly one permission bound to the exact step, node and operation identifiers. The first worker supports Gemini qualification, IF rules and Resend agency email only; other providers and Switch operations remain blocked.

Only auto, ask_first and never are valid permission values. Missing policy is not equivalent to auto. A permission envelope is not by itself an execution authorization: the worker must re-check the active immutable version, workspace connection, operation approval, consent, confidence/review gates and idempotency immediately before a side effect.

## Version and compatibility rules

- The Playbook is part of the same JSON definition saved by the workflow versioning RPC. It therefore shares the workflow's monotonically increasing version and immutable version snapshot.
- Editing an active Playbook must create a new draft version. Activation must explicitly point to the exact reviewed version.
- Existing definitions without a playbook property remain backward compatible during migration.
- Once a definition contains a Playbook, updates must preserve and revalidate it. A graph change that adds, removes or changes an action requires explicit matching permission updates; it must not inherit permission from another operation.
- Schema versions are explicit. Unknown fields and unsupported future versions fail closed.
- The Playbook envelope itself is stored in the existing workflows.definition and workflow_versions.definition JSONB; it does not need a duplicate definition table. The Decision Inbox uses a separate workspace-scoped decision table because pending approvals need independent querying, expiry, idempotency and atomic resolution.

## Trust and execution semantics

- Gemini extracts/classifies structured data. It does not decide whether an external action is authorized.
- Deterministic rules over validated fields control business routing.
- Confidence below threshold, missing required fields, unmatched rules and provider failures require human review when configured.
- never blocks the action.
- ask_first must create a durable pending decision and must not call the provider.
- auto allows an action only after all separate system gates pass.
- Historical replay is a side-effect-free evaluation of saved inputs against a selected Playbook version. It must not call Gemini, Resend, WhatsApp, webhooks or any external provider.
- Every final run/decision should identify the Playbook version, rule evaluation, decision reason, action policy, operation attempt, idempotency key and provider result.

## User-facing areas

1. **Control Room:** activation state, last outcomes, pending review count, failures and paused state.
2. **Decision Inbox:** uncertain leads and actions marked ask_first; users can approve, reject or correct extracted fields. Approval is version-bound, action-bound and expires or becomes invalid if the underlying lead, policy or connection changes.
3. **Outcome Ledger:** read-only, workspace-scoped view of existing lead activities and follow-up delivery records. The first release does not yet persist every rule evaluation and provider attempt as a complete event-sourced audit stream.
4. **Safe Preview:** validate the exact draft and replay a bounded sample of historical leads without provider calls or mutation.

## Current implementation boundary

- The durable lead worker executes Gemini qualification, deterministic IF rules and optional Resend agency notification. It records qualification/rule/decision/provider activity and uses the existing consent-aware email follow-up queue.
- Activation binds to the exact selected Gemini and Resend workspace connections and requires those connections to be freshly verified, their operations approved, the live provider opt-in enabled, and at least one active agency alert recipient approved by a workspace owner/admin. Playbook agency notifications use this existing workspace recipient allowlist rather than the generic workflow email-node recipient list.
- WhatsApp delivery, Google Calendar appointment creation, and CRM writes are not part of the current live Playbook worker. Their provider operations and template/setup work may exist in a separate draft bundle, but they must not be activated until consent, booking approval, idempotency, retry/reconciliation and Outcome Ledger coverage are implemented and verified.
- A clean migration replay and code-level tests are necessary but do not replace authenticated staging acceptance or an agency's end-to-end sign-off.

## Consolidation rules

- Keep one canonical definition and one registry execution plan.
- Retire the legacy linear builder and duplicated draft generation once the outcome-first setup route is live and regression-tested.
- Use one Gemini generation service/contract. The Assistant and editor must not independently invent workflow structures.
- Keep the graph editor as an advanced view of the same Playbook; do not maintain a second builder or localStorage-only source of truth.
- Reuse real-estate leads, activities, workflow runs, workflow versions and the existing durable pipeline.
- Do not expand to Marketplace, broad agent autonomy, WhatsApp or new CRMs until the first agency pilot validates the existing flow.

## Acceptance map for the requested eight deliverables

| Deliverable | Completion evidence |
|---|---|
| Audit and consolidate architecture | One documented architecture, one active authoring route, legacy routes redirected/retired, one validation/generation/persistence contract |
| Canonical Playbook definition | Strict schema validation, exact graph/operation binding, API round-trip, immutable version snapshot tests |
| Outcome-first setup | Nontechnical goal/rule/action-permission setup; generated draft requires review |
| Rules and permissions | Deterministic predicates, explicit auto/ask-first/never, server-side enforcement |
| Decision Inbox | Workspace-isolated durable queue, approve/reject/correct, version/action binding, no provider call before approval |
| Outcome Ledger | Workspace-scoped read-only activity and follow-up history; complete event-sourced provider trace remains a follow-up requirement |
| Historical replay and Safe Preview | Bounded deterministic replay; exact-version preview; guaranteed no external calls or writes |
| Real-estate pilot | Authenticated end-to-end staging test with approved test enquiry, Gemini, Resend and persisted result, plus agency sign-off; WhatsApp, calendar and CRM automations remain separate acceptance gates |

Code, CI or a Preview URL alone does not pass authenticated staging or customer acceptance.
