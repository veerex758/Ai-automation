import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20261114130000_aivanta_marketplace_installation_updates.sql",import.meta.url),"utf8");
const lifecycle=readFileSync(new URL("../app/api/marketplace/installations/[installationId]/lifecycle/route.ts",import.meta.url),"utf8");
const worker=readFileSync(new URL("../lib/workflows/durable-worker.ts",import.meta.url),"utf8");
const webhook=readFileSync(new URL("../app/api/webhooks/[endpointKey]/route.ts",import.meta.url),"utf8");
const scheduler=readFileSync(new URL("../app/api/internal/scheduler/route.ts",import.meta.url),"utf8");

test("updates require latest approved version and pause before creating replacement draft",()=>{
 assert.match(migration,/update_target_not_current_verified_version/);
 assert.match(migration,/pause_installation_before_version_transition/);
 assert.match(migration,/verification_status='approved'/);
 assert.match(migration,/status='archived'/);
 assert.match(migration,/status='configuring'/);
 assert.match(lifecycle,/targetVersionId!==product\.current_version_id/);
 assert.match(lifecycle,/successful dry-run/);
});

test("rollback only restores previously installed approved version and preserves compatible mappings",()=>{
 assert.match(migration,/rollback_target_not_in_installation_history/);
 assert.match(migration,/rollback_target_revoked_or_unverified/);
 assert.match(migration,/keep_configuration:=/);
 assert.match(migration,/configuration_preserved/);
 assert.match(lifecycle,/rollback/);
});

test("immutable workflow binding blocks queued and superseded Marketplace jobs",()=>{
 assert.match(migration,/marketplace_installation_workflow_bindings/);
 assert.match(migration,/i\.workflow_id is distinct from p_workflow_id/);
 assert.match(migration,/i\.product_version_id is distinct from binding\.product_version_id/);
 assert.match(migration,/i\.status<>'active'/);
 assert.match(worker,/marketplace_assert_installation_runtime/);
 assert.match(worker,/onStepStart:[\s\S]*marketplace_assert_installation_runtime/);
});

test("scheduled and webhook execution paths enforce installation revocation",()=>{
 assert.match(scheduler,/dispatch_workflow_execution/);
 assert.match(worker,/MARKETPLACE_INSTALLATION_REVOKED_OR_INACTIVE/);
 assert.match(webhook,/marketplace_assert_installation_runtime/);
 assert.match(webhook,/Marketplace installation is revoked, inactive, or superseded/);
});

test("emergency revocation pauses installations, disables schedules, revokes webhook ingress and emits customer notices",()=>{
 assert.match(migration,/verification_status='revoked'/);
 assert.match(migration,/update public\.workflow_schedules set enabled=false/);
 assert.match(migration,/update public\.webhook_endpoints set status='revoked'/);
 assert.match(migration,/update public\.marketplace_installations set status='paused'/);
 assert.match(migration,/insert into public\.marketplace_customer_notices/);
 assert.match(migration,/marketplace_version_revocation_notice/);
});

test("version changes retain history and every new workflow binding is immutable",()=>{
 assert.match(migration,/marketplace_installation_history/);
 assert.match(migration,/transition_action in \('initial','update','rollback'\)/);
 assert.match(migration,/marketplace_workflow_already_bound/);
 assert.match(migration,/on conflict\(workflow_id\) do nothing/);
});
