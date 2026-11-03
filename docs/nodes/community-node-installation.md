# Aivanta community node installation — security and architecture

## Decision

Aivanta will support a curated community-node ecosystem, but will not install or execute arbitrary npm packages inside the Next.js application, workflow runner, or a process that can read workspace secrets.

The existing `nodes/registry.ts` is the trusted first-party runtime registry. Community packages use a separate package contract and isolated worker adapter. A package appearing in a catalogue is not proof that it is installed, trusted, or executable.

## Installation lifecycle

1. **Discover** — show package name, exact version, publisher, description, runtime compatibility, requested permissions, review status, changelog and security scan date.
2. **Verify publisher** — verify the publisher identity and package provenance. Reject unscoped/unverified publishers and mutable version tags.
3. **Review artifact** — pin an exact version and SHA-512 integrity value; inspect source and dependency tree; reject install scripts, native binaries and unapproved transitive dependencies.
4. **Review permissions** — require explicit approval for each capability. Packages never receive raw workspace credentials. They invoke named connectors through a narrow broker.
5. **Install in isolation** — fetch and unpack the verified artifact in a dedicated worker/sandbox, not the Next.js server. No ambient environment variables, filesystem, process, or network access.
6. **Activate per workspace** — an owner/admin approves the package and requested permissions for that workspace. Store package/version/integrity and grant metadata; do not copy credentials into the package.
7. **Execute** — pass a short-lived, scoped invocation context through the worker adapter. Enforce CPU, memory, wall-clock, output-size, outbound-host and concurrency limits.
8. **Update / rollback** — updates are explicit, version-pinned and re-reviewed. Keep the previous artifact available for rollback. Uninstall revokes grants and removes the workspace activation; artifact garbage collection is separate.

## Runtime contract

The manifest contract lives in `lib/nodes/package-manifest.ts`. It requires an exact stable semver version, scoped package name, SHA-512 integrity, runtime API version, explicit permission list, no install scripts and no native dependencies.

Allowed permissions are capability names, not unrestricted operating-system privileges:
- `connector.invoke` — call a named, server-managed connector; raw credentials are never exposed.
- `http.outbound` — brokered outbound HTTP subject to host allowlists and SSRF protection.
- `workspace.storage.read` / `workspace.storage.write` — namespaced package storage only.
- `trigger.register` / `schedule.register` — register reviewed trigger/schedule definitions, never arbitrary cron code.
- `logger.write` — structured, redacted logs.

The manifest is a declaration, not authorization. Server-side registry review and workspace grants remain mandatory.

## Release phases

- **Phase 1 — Contract and policy:** schema, validator, review checklist and threat model. No third-party code executes.
- **Phase 2 — Registry and workspace manager:** trusted catalogue, publisher verification, package metadata, install/disable/update/uninstall records and audit trail.
- **Phase 3 — Isolated worker:** artifact fetch/verification, sandbox runtime adapter, capability broker, quotas and kill switch.
- **Phase 4 — Builder integration:** installed and authorized nodes appear in the builder; incompatible or revoked packages cannot be added or run.
- **Phase 5 — Ecosystem:** publisher portal, signed releases, review queue, security reporting and rollback tooling.

## Non-negotiable rules

- Never `npm install` a community package in the production app server at request time.
- Never `require()` or dynamically import untrusted package code into the workflow runner.
- Never pass Supabase service-role keys, encryption keys, provider API keys, cookies or environment variables to a package.
- Never treat catalogue presence or a successful package download as a successful installation.
- Never auto-update or auto-grant newly requested permissions.
- Revoke package execution immediately when a publisher/artifact is quarantined or a workspace grant is revoked.

## Current implementation boundary

This phase adds and validates the manifest contract only. It does not claim that community packages can already be installed or executed. The current first-party nodes remain compiled into the application and continue to use the existing registry/executor.


## Persistence model proposal (not yet migrated)

The database layer should separate platform trust from workspace consent. These are different authorities and must not be collapsed into one status field.

### Platform-owned registry records

- `node_publishers`: publisher identity, verification status, verification evidence reference, verified timestamp and reviewer. Only trusted platform reviewers may change verification state.
- `node_packages`: canonical scoped package name, publisher reference, display metadata and package-level lifecycle state.
- `node_package_versions`: immutable package/version pair, manifest JSON, entrypoint, SHA-512 integrity, runtime API version, dependency-scan result, malware-scan result, review decision and reviewer timestamps. A version's artifact identity is immutable after approval; a changed artifact requires a new version/review.

### Workspace-owned consent records

- `workspace_node_installations`: workspace, package-version reference, install state, installed-by actor, timestamps and optional disabled/uninstalled timestamps. Unique active install per workspace/package identity; retain history rather than hard-delete.
- `workspace_node_permission_grants`: installation reference, one capability per row, granted/revoked state, actor and timestamps. Never infer grants from the package manifest. Newly requested permissions require a new explicit approval.
- Every query and mutation must be workspace-scoped. Workspace owner/admin membership is required for install, grant, revoke, disable and uninstall. Members may only discover installed node metadata if product policy permits; they cannot mutate it.

### Audit trail

Use the existing `audit_events` table for append-only workspace lifecycle events only: `node.installation_created`, `node.permission_granted`, `node.permission_revoked`, `node.installation_disabled` and `node.installation_uninstalled`. Platform trust events such as publisher verification, version approval/rejection and package quarantine belong in a separate platform-controlled audit channel with its own reviewer identity and access policy; they must not be written through a workspace member API.

Audit metadata must contain identifiers, version/integrity references and permission names only. It must never contain package secrets, provider credentials, access tokens, encryption keys or raw package payloads. Workspace lifecycle events use the workspace ID and authenticated actor ID. The server derives both from the authenticated session and verified workspace membership; neither value is trusted from client-supplied metadata. Platform-only reviewer events are excluded from this workspace audit table.

### Database security requirements

- Enable RLS on every new table in the exposed `public` schema.
- Workspace records must be isolated using the existing private workspace membership/admin predicates, not a user-supplied workspace ID alone.
- Authenticated clients must not write publisher verification, package approval, scan results or quarantine state.
- Workspace members cannot self-approve publisher or package trust. Platform review operations must use a separately authorized server-side boundary.
- Permission grants are individual rows, with explicit revocation. Updates must preserve workspace ownership in both `USING` and `WITH CHECK` policies.
- Audit events are insert-only for authorized server-side lifecycle operations; no workspace client may update or delete audit history.
- Do not store executable package archives in public storage. Artifact retrieval belongs to a verified, isolated worker pipeline.

This is an architecture proposal only. No tables, policies, grants or migration-history entries have been created or changed in Supabase. The actual migration must be generated with `supabase migration new`, reviewed against the live staging policies, and applied only after explicit authorization.
