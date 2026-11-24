import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import {
  decryptWorkspaceCredentials,
  encryptWorkspaceCredentialsV3,
  getActiveWorkspaceCredentialKeyId,
  parseWorkspaceCredentialKeyring,
} from "../lib/integrations/workspace-credentials";

type SecretRow = { integration_id: string; encrypted_credentials: string; encryption_version: string };
type IntegrationRow = { id: string; workspace_id: string; provider: string };
type BackupEntry = {
  integration_id: string; workspace_id: string; provider: string;
  encrypted_credentials: string; encryption_version: string; rotated_encrypted_credentials?: string;
};
type BackupFile = { format: "rexnora-credential-ciphertext-backup-v1"; created_at: string; entries: BackupEntry[] };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(name);

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set the Supabase URL and service-role key in the shell.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
function associatedData(row: IntegrationRow, version: string) {
  return version === "v1" ? row.workspace_id + ":" + row.provider :
    row.workspace_id + ":" + row.provider + ":" + row.id;
}
async function saveBackup(path: string, backup: BackupFile) {
  await writeFile(path, JSON.stringify(backup, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
}
async function loadBackup(path: string): Promise<BackupFile> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as BackupFile;
  if (parsed.format !== "rexnora-credential-ciphertext-backup-v1" || !Array.isArray(parsed.entries)) {
    throw new Error("The supplied backup file has an unsupported format.");
  }
  for (const item of parsed.entries) {
    if (!item || typeof item.integration_id !== "string" || typeof item.workspace_id !== "string" ||
        typeof item.provider !== "string" || typeof item.encrypted_credentials !== "string" ||
        typeof item.rotated_encrypted_credentials !== "string" ||
        !["v1", "v2", "v3"].includes(item.encryption_version)) {
      throw new Error("Invalid ciphertext backup entry.");
    }
  }
  return parsed;
}
async function restore(path: string) {
  const backup = await loadBackup(path);
  const db = adminClient();
  let restored = 0;
  for (const entry of backup.entries) {
    const { data: current, error: lookupError } = await db.from("workspace_integration_secrets")
      .select("encrypted_credentials").eq("integration_id", entry.integration_id).maybeSingle();
    if (lookupError || !current) throw new Error("Restore stopped at a row. Retain the backup and investigate before retrying.");
    if (current.encrypted_credentials === entry.encrypted_credentials) continue;
    if (current.encrypted_credentials !== entry.rotated_encrypted_credentials) {
      throw new Error("Restore refused to overwrite a credential changed after rotation. Reconcile the row before retrying.");
    }
    const { data, error } = await db.from("workspace_integration_secrets")
      .update({
        encrypted_credentials: entry.encrypted_credentials,
        encryption_version: entry.encryption_version,
        updated_at: new Date().toISOString(),
      })
      .eq("integration_id", entry.integration_id)
      .eq("encrypted_credentials", entry.rotated_encrypted_credentials)
      .select("integration_id").maybeSingle();
    if (error || !data) throw new Error("Restore stopped at a row. Retain the backup and investigate before retrying.");
    restored += 1;
  }
  process.stdout.write(JSON.stringify({ restored, backupCreatedAt: backup.created_at }) + "\n");
}
async function main() {
  const apply = hasFlag("--apply");
  const restorePath = arg("--restore-from");
  if (restorePath) {
    if (!apply) throw new Error("Restore requires the explicit --apply flag.");
    await restore(restorePath);
    return;
  }
  const backupPath = arg("--backup");
  if (apply && !backupPath) throw new Error("Rotation with --apply requires --backup <new-file-path>.");
  if (!parseWorkspaceCredentialKeyring() || !getActiveWorkspaceCredentialKeyId()) {
    throw new Error("AIVANTA_CREDENTIALS_ENCRYPTION_KEYRING must be configured before rotation.");
  }

  const db = adminClient();
  const rows: SecretRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data: page, error: secretError } = await db.from("workspace_integration_secrets")
      .select("integration_id,encrypted_credentials,encryption_version")
      .order("integration_id", { ascending: true }).range(offset, offset + 499);
    if (secretError) throw new Error("Could not enumerate workspace credentials. No rows were changed.");
    rows.push(...((page ?? []) as SecretRow[]));
    if (!page || page.length < 500) break;
  }
  const pending: Array<{ integration: IntegrationRow; secret: SecretRow; encrypted: string }> = [];
  let alreadyActive = 0;
  const activeKeyId = getActiveWorkspaceCredentialKeyId();

  for (const secret of rows) {
    const { data: integration, error } = await db.from("workspace_integrations")
      .select("id,workspace_id,provider").eq("id", secret.integration_id).maybeSingle();
    if (error || !integration) throw new Error("Could not resolve credential tenant context. No rows were changed.");
    const row = integration as IntegrationRow;
    const oldKeyId = secret.encryption_version === "v3" ? secret.encrypted_credentials.split(".")[1] : null;
    if (secret.encryption_version === "v3" && oldKeyId === activeKeyId) {
      alreadyActive += 1;
      continue;
    }
    const credentials = decryptWorkspaceCredentials(
      secret.encrypted_credentials, undefined, associatedData(row, secret.encryption_version),
    );
    const encrypted = encryptWorkspaceCredentialsV3(credentials, associatedData(row, "v3"));
    pending.push({ integration: row, secret, encrypted });
  }

  process.stdout.write(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    total: rows.length,
    alreadyOnActiveKey: alreadyActive,
    requiringRotation: pending.length,
    activeKeyId,
  }) + "\n");
  if (!apply) return;

  const backup: BackupFile = {
    format: "rexnora-credential-ciphertext-backup-v1",
    created_at: new Date().toISOString(),
    entries: pending.map(({ integration, secret, encrypted }) => ({
      integration_id: integration.id, workspace_id: integration.workspace_id,
      provider: integration.provider, encrypted_credentials: secret.encrypted_credentials,
      encryption_version: secret.encryption_version, rotated_encrypted_credentials: encrypted,
    })),
  };
  await saveBackup(backupPath!, backup);

  let updated = 0;
  for (const item of pending) {
    const { data, error } = await db.from("workspace_integration_secrets")
      .update({
        encrypted_credentials: item.encrypted,
        encryption_version: "v3",
        updated_at: new Date().toISOString(),
      })
      .eq("integration_id", item.integration.id)
      .eq("encrypted_credentials", item.secret.encrypted_credentials)
      .select("integration_id").maybeSingle();
    if (error || !data) {
      throw new Error("Rotation stopped after " + updated + " updates. Keep the backup and investigate.");
    }
    updated += 1;
  }
  process.stdout.write(JSON.stringify({ updated, backupPath }) + "\n");
}
main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : "Credential rotation failed.") + "\n");
  process.exitCode = 1;
});
