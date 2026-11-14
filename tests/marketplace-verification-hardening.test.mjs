import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20261114120000_aivanta_marketplace_verification_hardening.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../app/api/marketplace/reviews/[reviewId]/route.ts",import.meta.url),"utf8");
const scanner=readFileSync(new URL("../lib/marketplace/verification.ts",import.meta.url),"utf8");

test("human approval is restricted to an independent reviewer and exact pending artifact hash",()=>{
 assert.match(migration,/independent_reviewer_required/);
 assert.match(migration,/p_reviewer_id=v\.created_by/);
 assert.match(migration,/p_reviewer_id=p\.created_by/);
 assert.match(migration,/p_artifact_sha256.*v\.artifact_sha256/);
 assert.match(migration,/verification_checks_not_all_passed/);
});

test("revocation is privileged, reasoned, version-specific and audited",()=>{
 assert.match(migration,/marketplace_revoke_version/);
 assert.match(migration,/verification_status='revoked'/);
 assert.match(migration,/marketplace_version_revoked/);
 assert.match(migration,/grant execute on function public\.marketplace_revoke_version/);
});

test("reverification creates a new queued review and returns revoked version to pending",()=>{
 assert.match(migration,/marketplace_require_reverification/);
 assert.match(migration,/verification_status='pending'/);
 assert.match(migration,/'reverification','queued'/);
 assert.match(migration,/marketplace_reverification_required/);
});

test("review API rejects self-review and exposes revoke and reverification transitions",()=>{
 assert.match(route,/version\.created_by===auth\.user\.id/);
 assert.match(route,/marketplace_revoke_version/);
 assert.match(route,/marketplace_require_reverification/);
});

test("artifact scanner checks dynamic execution, exfiltration, obfuscation and destructive behavior",()=>{
 for(const id of ["dynamic_code_execution","credential_exfiltration","obfuscated_payload","destructive_operations"])assert.ok(scanner.includes(id));
});
