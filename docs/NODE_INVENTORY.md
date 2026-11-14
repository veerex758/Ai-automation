# Aivanta node inventory — source of truth

This document distinguishes the executable workflow registry from the user-facing provider directory. They are separate inventories and must not be conflated.

## Authoritative counts

| Inventory | Count | Meaning |
|---|---:|---|
| Native executable registry | **122** | Definitions exposed by `getExecutableNodeCatalog()`; used by workflow validation, AI planning and execution |
| Provider directory | **100** | User-facing provider entries exposed by `getPublicNodeCatalog()` |
| Provider entries with registered implementations | **100** | Every provider-directory entry resolves to a registered implementation |
| Coming-soon provider entries | **0** | No provider-directory entry is currently marked coming soon |

The native count and provider-directory parity are asserted by `tests/provider-catalog.test.ts`. The operation-level parity gate is `tests/worker-operation-parity.test.ts`, which requires every registered trigger/action to have exactly one worker mapping.

The registry includes core triggers and logic/data primitives, internal utility nodes, provider packs, and provider catalogue adapters. Avoid publishing old family-level subtotals unless they have been regenerated from the current registry; earlier category tables became stale as nodes were added.

## Database adapters

MySQL and MongoDB have registered native adapters in `nodes/sql-document-databases.ts`. The Database service integration workflow exercises both against authenticated TLS database containers. This proves driver-level integration against test services, not that every workspace has valid production credentials or permissions.

## Reporting rules

- Say **122 executable nodes** for the native workflow registry.
- Say **100 provider-directory entries; 100 registered; 0 coming soon** for the provider directory.
- Do not describe all 100 providers as live-production-verified. Registration, schemas, worker mappings and database-container integration tests do not prove OAuth consent, credentials, provider-side permissions, or successful authenticated staging execution.
- Use `tests/worker-operation-parity.test.ts` as the operation-to-worker parity gate.
- Treat provider live enablement, workspace connection readiness and per-operation approval as separate release gates.
