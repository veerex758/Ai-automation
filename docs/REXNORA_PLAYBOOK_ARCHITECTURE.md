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

The graph is the only source of truth for condition predicates and edges. A Playbook rule labels one existing condition node; it must not copy the predicate into a second format. Every executable action step except the deterministic IF/Switch evaluator must have exactly one permission bound to the exact step, node and operation identifiers.

Only auto, ask_first and never are valid permission values. Missing policy is not equivalent to auto. A permission envelope is not by itself an execution authorization: the worker must re-check the active immutable version, workspace connection, operation approval, consent, confidence/review gates and idempotency immediately before a side effect.

## Version and compatibility rules

- The Playbook is part of the same JSON definition saved by the workflow versioning RPC. It therefore shares the workflow's monotonically increasing version and immutable version snapshot.
- Editing an active Playbook must create a new draft version. Activation must explicitly point to the exact reviewed version.
- Existing definitions without a playbook property remain backward compatible during migration.
- Once a definition contains a Playbook, updates must preserve and revalidate it. A graph change that adds, removes or changes an action requires explicit matching permission updates; it must not inherit permission from another operation.
- Schema versions are explicit. Unknown fields and unsupported future versions fail closed.
- No DB migration is needed for this envelope because workflows.definition and workflow_versions.definition already store JSONB. A new table should be introduced only for independently queryable decision/inbox items, not for a second copy of the Playbook definition.

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
3. **Outcome Ledger:** read-only, append-only explanation of the enquiry, extraction, deterministic rules, rationale, action permission, approval, provider attempt/result and follow-up status.
4. **Safe Preview:** validate the exact draft and replay a bounded sample of historical leads without provider calls or mutation.

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
| Outcome Ledger | Append-only trace with extraction, rule results, rationale, action attempts, provider outcomes |
| Historical replay and Safe Preview | Bounded deterministic replay; exact-version preview; guaranteed no external calls or writes |
| Real-estate pilot | Authenticated end-to-end staging test with approved test enquiry, Gemini, Resend and persisted result, plus agency sign-off |

Code, CI or a Preview URL alone does not pass authenticated staging or customer acceptance.
