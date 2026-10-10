# Aivanta product roadmap

Aivanta is being built as a staged business automation platform: conventional workflows first, AI-assisted steps next, and more advanced agents only when the controls and use cases justify them.

## Stage 1 — Product foundation
- [x] Establish a Next.js + TypeScript application shell.
- [x] Create the initial responsive marketing experience.
- [x] Add automated linting, type-checking, and build verification.
- [x] Add a dashboard shell and workspace navigation.
- [x] Define the initial workflow definition shape and reusable validation rules in `lib/workflows/validation.ts`.

## Stage 2 — Workflow workspace

Current foundation: the visual builder and dashboard store prototype drafts in browser storage only. Shared validation rules exist, but are not yet connected to an API route or persistent database.
- [ ] Create, edit, save, and version workflow definitions.
- [ ] Build a visual workflow editor with explicit triggers, actions, and conditions.
- [ ] Add a safe test/dry-run mode and useful execution history.
- [ ] Keep credentials out of workflow JSON, logs, and client-side code.

## Stage 3 — Real integrations
- [ ] Introduce a provider adapter interface and integration registry.
- [ ] Start with a small number of well-defined integrations.
- [ ] Implement OAuth/state validation, scoped permissions, token encryption, revocation, and audit events.
- [ ] Add retries, rate-limit handling, idempotency, and operational monitoring.

## Stage 4 — AI-assisted workflow creation
- [ ] Convert user requests into a structured, validated workflow proposal.
- [ ] Require users to inspect and approve generated actions before activation.
- [ ] Treat connected services, external documents, and tool output as untrusted input.
- [ ] Add configurable human approval gates for consequential actions.

## Stage 5 — Teams and commercial foundations
- [ ] Add authentication, organization membership, and tenant isolation.
- [ ] Add usage metering, plan limits, and billing integration.
- [ ] Define retention, deletion, export, and incident-response procedures.
- [ ] Run security reviews and end-to-end tests before inviting production customers.

## Engineering principles
- Security and tenant isolation are architectural requirements, not marketing claims.
- Never store secrets in source control or return provider tokens to the browser.
- Validate every workflow definition and authorize every execution server-side.
- Prefer transparent, bounded workflows before open-ended autonomous behavior.
- Clearly label mock data and prototypes; never imply an integration is live until it has been implemented and tested.
- Keep the first release small enough to test thoroughly.
