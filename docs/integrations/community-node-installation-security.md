# Safe community-node installation policy

Aivanta may discover a broad range of n8n community-node packages, but discovery is not installation and installation is not permission to execute package code.

## Trust states

- **Discovered / pending review:** package metadata only; never load or execute package code.
- **Approved:** a reviewer has checked provenance, pinned version and integrity, dependency tree, license, advisories, requested capabilities, and the Aivanta adapter contract.
- **Installed:** an approved, integrity-pinned package has a registered Aivanta adapter. The runtime still uses Aivanta's own operation registry; it does not dynamically import arbitrary npm packages into the web or worker process.
- **Disabled / uninstalled:** not available to new workflows. Existing workflow references must fail closed with a clear unavailable-node error.
- **Blocked:** rejected or withdrawn because of risk, vulnerability, incompatibility, or policy violation.

## Mandatory gates

1. Resolve packages only from the official npm registry allowlist; reject arbitrary registries, git URLs, tarball URLs, install scripts, and unpinned versions.
2. Pin exact package versions and verify the registry's SHA-512 integrity value before approval and on every artifact retrieval.
3. Review maintainer/provenance signals, license, dependency tree, known vulnerabilities, package age/maintenance, and unexpected publish changes.
4. Reject install lifecycle scripts and packages requiring unrestricted filesystem, process, network, shell, environment, or credential access.
5. Require an explicit Aivanta adapter with declared input/output schemas, capabilities, and permissions. Unknown capabilities are denied.
6. Keep secrets in Aivanta's encrypted workspace credential store. Never pass raw credentials into package metadata, logs, audit details, or browser code.
7. Execute approved adapters in a restricted worker boundary with outbound network allowlists, resource/time limits, and no ambient secrets. Until that isolated runtime exists and is tested, community package code remains non-executable.
8. Record every discovery, review, approval, install, update, disable, enable, block, and uninstall action in the append-only audit table.
9. Re-review on version changes and new advisories. Updates never happen silently.
10. A package cannot grant itself approval, permissions, or an adapter identity.

## Data model

The workspace_node_installations table stores workspace-scoped package/version/integrity, adapter identity, review state, permission declarations, and risk metadata. The workspace_node_installation_audit table stores the server-written event history. Authenticated workspace members can read installation metadata; mutations and audit access are reserved to server-side service-role handlers after owner/admin authorization.

## Rollback

If no installation data needs preserving, drop workspace_node_installation_audit first, then workspace_node_installations. Do not roll back by resetting migration history or dropping unrelated integration tables.
