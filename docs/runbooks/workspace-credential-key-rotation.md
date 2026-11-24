# Workspace credential key rotation

This procedure covers only workspace_integration_secrets. Google OAuth token encryption and webhook signing-secret encryption use separate stores and keys.

## Keyring format

Configure AIVANTA_CREDENTIALS_ENCRYPTION_KEYRING as server-only JSON:

```json
{
  "activeKeyId": "key-2026-11",
  "keys": {
    "key-2026-11": "base64-encoded-32-byte-key",
    "key-2026-10": "previous-base64-encoded-32-byte-key"
  }
}
```

Generate each key independently with openssl rand -base64 32. Never reuse the webhook or Google token encryption key. Keep old keys during the migration and rollback window.

## Safe rollout

1. Reconcile the target Supabase migration history first. Apply migration 20261124110000_rexnora_security_keyring_and_ingress_rate_limits.sql only through the approved deployment process.
2. Configure the keyring on Preview with the new active key and all prior keys. Keep AIVANTA_CREDENTIALS_ENCRYPTION_KEY unchanged so v1/v2 rows remain decryptable.
3. Deploy and verify new connection writes use encryption_version=v3 and provider connection tests plus worker reads succeed.
4. Run npx tsx scripts/rotate-workspace-credentials.ts with no flags. This is a dry run and prints counts/key ID only.
5. Review the counts and select a protected backup path that does not already exist. With explicit operational approval, run:
   npx tsx scripts/rotate-workspace-credentials.ts --apply --backup /secure/path/rexnora-credentials-before-rotation.json
   The backup is created exclusively with mode 0600 and stores ciphertext/identifiers/versions only.
6. Run the dry-run again; requiringRotation should be zero. Confirm connection tests and worker reads for each provider group.
7. Keep all old keys until verification is complete and rollback is closed. Remove old keys only after confirming no ciphertext references them.

## Rollback

Restore from a ciphertext-only backup with explicit apply:
   npx tsx scripts/rotate-workspace-credentials.ts --restore-from /secure/path/rexnora-credentials-before-rotation.json --apply

The original legacy key or keyring entries must remain configured for restored envelopes. Restore is row-by-row; verify counts and re-run connection tests before reopening writes.

## Safeguards

- The script defaults to dry-run. Writes require --apply; rotation additionally requires a new backup path.
- Every new envelope uses a fresh AES-GCM nonce and binds ciphertext to workspace/provider/connection.
- Updates compare the previous ciphertext to avoid overwriting concurrent credential changes.
- Do not remove the legacy single key until all v1/v2 rows are migrated and verified.
- This is not a substitute for a database backup, secret-manager controls, or authenticated cross-workspace acceptance.
