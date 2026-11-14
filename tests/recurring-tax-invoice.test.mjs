import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const migration=await readFile(new URL("../supabase/migrations/20261114200000_aivanta_recurring_billing_tax_invoices.sql",import.meta.url),"utf8");
const lifecycle=await readFile(new URL("../supabase/migrations/20261114210000_aivanta_recurring_subscription_lifecycle.sql",import.meta.url),"utf8");
const stripeCheckout=await readFile(new URL("../app/api/billing/stripe/subscribe/route.ts",import.meta.url),"utf8");
const stripeWebhook=await readFile(new URL("../app/api/billing/stripe/subscription-webhook/route.ts",import.meta.url),"utf8");
const paystackAuthorize=await readFile(new URL("../app/api/billing/paystack/recurring/authorize/route.ts",import.meta.url),"utf8");
const paystackWebhook=await readFile(new URL("../app/api/billing/webhook/route.ts",import.meta.url),"utf8");
const paystackCron=await readFile(new URL("../app/api/internal/billing/paystack-renewals/route.ts",import.meta.url),"utf8");
const invoice=await readFile(new URL("../app/api/billing/invoices/[paymentId]/issue/route.ts",import.meta.url),"utf8");
const cron=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
test("recurring billing and invoice data are service-role protected and RLS enabled",()=>{
 for(const table of ["workspace_billing_customers","billing_recurring_events","billing_invoices","billing_tax_rules"])assert.match(migration,new RegExp("alter table public\\."+table+" enable row level security"));
 assert.match(migration,/revoke all on public\.workspace_billing_customers[\s\S]*from public,anon,authenticated/);
 assert.match(migration,/billing_invoices_payment_uidx/);
});
test("Stripe recurring checkout only uses approved server recurring prices",()=>{
 assert.match(stripeCheckout,/mode:"subscription"/);assert.match(stripeCheckout,/price\.type!=="recurring"/);assert.match(stripeCheckout,/price\.unit_amount!==plan\.amountMinor/);assert.match(stripeCheckout,/subscription_data:\{metadata/);assert.match(stripeCheckout,/canManageWorkspaceBilling/);
});
test("Stripe recurring webhook verifies signature and processes invoice paid, failure and cancellation",()=>{
 assert.match(stripeWebhook,/constructEvent/);assert.match(stripeWebhook,/invoice\.paid/);assert.match(stripeWebhook,/invoice\.payment_failed/);assert.match(stripeWebhook,/customer\.subscription\.deleted/);assert.match(stripeWebhook,/billing_recurring_events/);assert.match(stripeWebhook,/settle_workspace_payment/);
});
test("Paystack recurring setup requires authenticated billing manager and reusable auth captured encrypted",()=>{
 assert.match(paystackAuthorize,/canManageWorkspaceBilling/);assert.match(paystackAuthorize,/recurring_setup:true/);assert.match(paystackWebhook,/authorization\.reusable!==true/);assert.match(paystackWebhook,/encryptWebhookSecret/);assert.match(paystackWebhook,/paystack_authorization_code_enc/);
});
test("Paystack renewal scheduler is cron protected, decrypts auth, charges and idempotently claims cycles",()=>{
 assert.match(paystackCron,/authorization!==\"Bearer \"\+cron/);assert.match(paystackCron,/charge_authorization/);assert.match(paystackCron,/billing_recurring_events/);assert.match(paystackCron,/current_period_end/);assert.ok(cron.crons.some(c=>c.path==="/api/internal/billing/paystack-renewals"));
});
test("tax invoice issuance requires legal seller settings and paid transaction; snapshots tax and customer",()=>{
 assert.match(invoice,/payment\.status!==\"success\"/);assert.match(invoice,/AIVANTA_LEGAL_ENTITY_NAME/);assert.match(invoice,/AIVANTA_TAX_JURISDICTION/);assert.match(invoice,/rate_basis_points/);assert.match(invoice,/tax_rule_snapshot/);assert.match(invoice,/next_workspace_invoice_number/);assert.match(invoice,/billing_invoices/);assert.match(lifecycle,/next_workspace_invoice_number/);
});
