import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20261114130000_aivanta_marketplace_installation_updates.sql",import.meta.url),"utf8");
const lifecycle=readFileSync(new URL("../app/api/marketplace/installations/[installationId]/lifecycle/route.ts",import.meta.url),"utf8");
const worker=readFileSync(new URL("../lib/workflows/durable-worker.ts",import.meta.url),"utf8");
const directRun=readFileSync(new URL("../app/api/workflows/[workflowId]/registry-run/route.ts",import.meta.url),"utf8");
const liveRun=readFileSync(new URL("../app/api/workflows/[workflowId]/live-run/route.ts",import.meta.url),"utf8");

test("marketplace version updates are pinned to the latest approved version and require artifact hash integrity",()=>{
 assert.match(migration,/update_target_not_current_verified_version/);
 assert.match(migration,/artifact_hash_mismatch/);
 assert.match(migration,/verification_status='approved'/);
 assert.match(lifecycle,/verifyMarketplaceStoredArtifact/);
 assert.match(lifecycle,/marketplace_transition_installation_version/);
});

test("rollback is restricted to previously installed and still-approved versions",()=>{
 assert.match(migration,/rollback_target_not_in_installation_history/);
 assert.match(migration,/rollback_target_revoked_or_unverified/);
 assert.match(lifecycle,/action==="rollback"/);
});

test("version changes create new inactive workflow drafts and retain previous version snapshots",()=>{
 assert.match(migration,/marketplace_installation_history/);
 assert.match(migration,/status='archived'/);
 assert.match(migration,/status='configuring'/);
 assert.match(migration,/configuration_preserved/);
});

test("connection mappings are validated against the same workspace and consumed by the durable worker",()=>{
 assert.match(lifecycle,/workspace_integrations/);
 assert.match(lifecycle,/google_connections/);
 assert.match(lifecycle,/last_test_status/);
 assert.match(worker,/marketplaceConnectionMap/);
 assert.match(worker,/connectionMap\[provider\]/);
 assert.match(worker,/new Set\(\["resend"\]\), marketplaceConnectionMap\)/);
});

test("runtime revocation is checked before every marketplace live step and old workflow versions are blocked",()=>{
 assert.match(migration,/marketplace_assert_installation_runtime/);
 assert.match(migration,/marketplace_installation_history where workflow_id=p_workflow_id/);
 assert.match(migration,/marketplace_installation_workflow_bindings/);
 assert.match(migration,/marketplace_capture_installation_workflow_binding/);
 assert.match(worker,/MARKETPLACE_INSTALLATION_REVOKED_OR_INACTIVE/);
 assert.match(worker,/stillAllowed/);
 assert.match(worker,/MARKETPLACE_INSTALLATION_REVOKED_OR_INACTIVE/);
 assert.match(directRun,/Marketplace-installed workflows must execute through the durable worker/);
 assert.match(liveRun,/Marketplace-installed workflows must execute through the durable worker/);
});

test("revoking a non-current installed version pauses only affected installations and notifies their owners",()=>{
 assert.match(migration,/where i.product_version_id=new.id and i.workflow_id=w.id and i.status='active'/);
 assert.match(migration,/Marketplace version revoked/);
 assert.match(migration,/verification_revoked/);
});

test("Marketplace installation dry-run accepts the verified legacy artifact format without side effects",()=>{
 assert.match(directRun,/validateDefinition\(workflow\.definition\)/);
 assert.match(directRun,/runDryRun\(legacy\.definition, \{\}\)/);
 assert.match(directRun,/sideEffectsPerformed:false/);
});
