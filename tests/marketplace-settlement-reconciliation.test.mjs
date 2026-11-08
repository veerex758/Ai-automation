import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261108120000_aivanta_marketplace_provider_settlement_reconciliation.sql",import.meta.url),"utf8");
test("settlement statement imports are service-role only and immutable",()=>{assert.match(sql,/auth\.role\(\)<>'service_role'/);assert.match(sql,/statement_sha256/);assert.match(sql,/unique\(provider,statement_reference\)/);assert.match(sql,/revoke all on function public\.marketplace_reconcile_provider_settlement/);assert.match(sql,/grant execute on function public\.marketplace_reconcile_provider_settlement.*service_role/)});
test("reconciliation identifies matched, mismatched, unknown and duplicate transfers",()=>{for(const s of ["matched","amount_mismatch","currency_mismatch","unknown_transfer","duplicate_transfer"])assert.ok(sql.includes(s));assert.match(sql,/payout\.amount_minor<>amount/);assert.match(sql,/payout\.currency<>currency/);assert.match(sql,/provider_transfer_id=transfer/)});
test("statement input is bounded and reports explicit exception counts",()=>{assert.match(sql,/jsonb_array_length\(p_rows\)>10000/);assert.match(sql,/exceptions/);assert.match(sql,/reconciled,mismatches=0/)});
